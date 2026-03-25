/**
 * Duration calculation service
 * Extracts audio durations, validates against targets, and generates reports
 */

import { parseFile } from 'music-metadata'
import { createLogger } from '../utils/logger'
import type { DurationReport } from '../types/audio'
import { DurationGoWrapper } from './DurationGoWrapper'
import type { DurationGoConfig } from '../../config/DurationGoConfig'

/**
 * Injectable metadata reader type for duration extraction.
 * In production: reads duration from music-metadata parseFile.
 * In tests: returns controlled values without real files.
 */
export type DurationMetadataReader = (filePath: string) => Promise<number>

/**
 * Dependencies for DurationService (enables testability)
 */
export interface DurationServiceDeps {
  metadataReader?: DurationMetadataReader
  goBackendConfig?: DurationGoConfig
  enableGoBackend?: boolean
}

/**
 * Default metadata reader using music-metadata
 */
const defaultMetadataReader: DurationMetadataReader = async (filePath) => {
  const meta = await parseFile(filePath)
  return meta.format.duration ?? 0
}

/**
 * Provides duration calculation, tolerance validation, and reporting for audio files.
 * Used by AudioMergeService for grouping decisions.
 */
export class DurationService {
  private readonly metadataReader: DurationMetadataReader
  private readonly goBackendEnabled: boolean
  private readonly logger = createLogger('duration')

  constructor(deps: DurationServiceDeps = {}) {
    this.metadataReader = deps.metadataReader ?? defaultMetadataReader
    this.goBackendEnabled = deps.enableGoBackend ?? false

    if (this.goBackendEnabled && deps.goBackendConfig) {
      // 初始化 Go 後端
      const binaryPath = deps.goBackendConfig.goBinaryPath
      DurationGoWrapper.init(binaryPath, deps.goBackendConfig)
    }
  }

  /**
   * Get duration of a single audio file in seconds.
   *
   * @param filePath - Path to the audio file
   * @returns Duration in seconds (float)
   */
  async getDuration(filePath: string): Promise<number> {
    return this.metadataReader(filePath)
  }

  /**
   * Calculate total duration of multiple audio files.
   * Strategy: Try Go backend first if enabled, fallback to Bun Promise.all
   *
   * @param filePaths - Array of file paths (empty array returns 0)
   * @returns Total duration in seconds
   */
  async calculateTotalDuration(filePaths: ReadonlyArray<string>): Promise<number> {
    if (filePaths.length === 0) return 0

    // Try Go backend first if enabled
    if (this.goBackendEnabled && (await DurationGoWrapper.isAvailable())) {
      try {
        const startTime = performance.now()
        const durations = await DurationGoWrapper.readMetadata(filePaths)
        const elapsedMs = performance.now() - startTime

        // Validate read results
        if (durations.size > 0) {
          const total = Array.from(durations.values()).reduce((sum, d) => sum + d, 0)
          this.logger.info(
            {
              filesRead: durations.size,
              totalFiles: filePaths.length,
              totalDuration: total,
              elapsedMs: Math.round(elapsedMs),
            },
            'Go backend duration read completed'
          )

          // If partial read, supplement missing files with Bun
          if (durations.size < filePaths.length) {
            const readPaths = new Set(durations.keys())
            const missingPaths = filePaths.filter(fp => !readPaths.has(fp))

            // Use Promise.allSettled to handle partial fallback failures gracefully
            const fallbackResults = await Promise.allSettled(
              missingPaths.map(fp => this.getDuration(fp))
            )

            fallbackResults.forEach((result, i) => {
              if (result.status === 'fulfilled') {
                durations.set(missingPaths[i], result.value)
              } else {
                this.logger.warn(
                  { file: missingPaths[i], error: result.reason },
                  'Bun fallback read failed'
                )
                // Skip this file; partial success is acceptable
              }
            })
          }

          return Array.from(durations.values()).reduce((sum, d) => sum + d, 0)
        }
      } catch (error) {
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Go backend failed, falling back to Bun'
        )
        // Continue to fallback
      }
    }

    // Fallback: Original Bun implementation (Promise.all)
    const durations = await Promise.all(
      filePaths.map(fp => this.getDuration(fp))
    )
    return durations.reduce((sum, d) => sum + d, 0)
  }

  /**
   * Validate if actual duration is within the specified tolerance of the target.
   *
   * Lower bound = targetSeconds * (1 - tolerancePercent / 100)
   * Upper bound = targetSeconds * (1 + tolerancePercent / 100)
   *
   * @param actualSeconds - Actual duration to validate
   * @param targetSeconds - Target duration
   * @param tolerancePercent - Tolerance as a percentage (default: 10 means ±10%)
   * @returns true if actualSeconds is within [lower, upper] bounds inclusive
   */
  validateDuration(
    actualSeconds: number,
    targetSeconds: number,
    tolerancePercent: number = 10
  ): boolean {
    const lower = targetSeconds * (1 - tolerancePercent / 100)
    const upper = targetSeconds * (1 + tolerancePercent / 100)
    return actualSeconds >= lower && actualSeconds <= upper
  }

  /**
   * Generate a complete duration report for a set of files.
   *
   * @param filePaths - Files to include in the report
   * @param targetSeconds - Target total duration (default: 39600 = 11 hours)
   * @param tolerancePercent - Tolerance percentage (default: 10 means ±10%)
   * @returns DurationReport with per-file durations, total, and tolerance check
   */
  async generateReport(
    filePaths: ReadonlyArray<string>,
    targetSeconds: number = 39600,
    tolerancePercent: number = 10
  ): Promise<DurationReport> {
    const files = await Promise.all(
      filePaths.map(async (fp) => ({
        path: fp,
        duration: await this.getDuration(fp),
      }))
    )
    const totalDuration = files.reduce((sum, f) => sum + f.duration, 0)

    this.logger.debug(
      { totalDuration, targetSeconds, tolerancePercent },
      `Duration report: ${this.formatDuration(totalDuration)} / target ${this.formatDuration(targetSeconds)}`
    )

    return {
      files,
      totalDuration,
      targetDuration: targetSeconds,
      withinTolerance: this.validateDuration(totalDuration, targetSeconds, tolerancePercent),
      tolerancePercent,
    }
  }

  /**
   * Format a duration in seconds to a human-readable string.
   *
   * @param seconds - Duration in seconds
   * @returns Formatted string like "11h 00m 00s"
   */
  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
  }
}
