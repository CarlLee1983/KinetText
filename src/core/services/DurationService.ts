/**
 * Duration calculation service
 * Extracts audio durations, validates against targets, and generates reports
 */

import { parseFile } from 'music-metadata'
import { createLogger } from '../utils/logger'
import type { DurationReport } from '../types/audio'

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
  private readonly logger = createLogger('duration')

  constructor(deps: DurationServiceDeps = {}) {
    this.metadataReader = deps.metadataReader ?? defaultMetadataReader
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
   *
   * @param filePaths - Array of file paths (empty array returns 0)
   * @returns Total duration in seconds
   */
  async calculateTotalDuration(filePaths: ReadonlyArray<string>): Promise<number> {
    if (filePaths.length === 0) return 0
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
