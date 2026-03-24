/**
 * MP4 conversion pipeline orchestrator
 * Coordinates merged MP3 files → M4A conversion with metadata and error handling
 */

import { AudioMergeService } from './AudioMergeService'
import { MP4ConversionService } from './MP4ConversionService'
import { DurationService } from './DurationService'
import { MP4Metadata, MP4ConversionResult, MP4PipelineReport } from '../types/audio'
import { MP4ConversionConfig } from '../config/MP4ConversionConfig'
import { getLogger } from '../utils/logger'

const logger = getLogger('MP4Pipeline')

/**
 * Options for MP4Pipeline execution
 */
export interface MP4PipelineOptions {
  /** Input directory containing merged MP3 files from Phase 3 */
  readonly mergedAudioDir: string
  /** Output directory for generated M4A files */
  readonly outputDir: string
  /** Optional metadata map: filename → MP4Metadata */
  readonly metadataSource?: Readonly<Record<string, MP4Metadata>>
  /** Preview mode: show what would be converted without executing FFmpeg */
  readonly dryRun?: boolean
}

/**
 * MP4 conversion pipeline service
 * Orchestrates the full workflow: discover merged files → validate → convert → report
 */
export class MP4Pipeline {
  private readonly logger: any

  constructor(
    private readonly audioMergeService: AudioMergeService,
    private readonly mp4ConversionService: MP4ConversionService,
    private readonly durationService: DurationService,
    private readonly config: MP4ConversionConfig
  ) {
    this.logger = getLogger('MP4Pipeline')
  }

  /**
   * Execute the full MP4 conversion pipeline
   * Discovers merged MP3 files, builds conversion tasks, executes with optional dry-run
   *
   * @param options Pipeline execution options
   * @returns MP4PipelineReport with results and error summary
   */
  async execute(options: MP4PipelineOptions): Promise<MP4PipelineReport> {
    const startTime = Date.now()
    const errors: string[] = []

    try {
      // Validate input directory
      const inputDir = Bun.file(options.mergedAudioDir)
      if (!(await inputDir.exists())) {
        throw new Error(`Input directory not found: ${options.mergedAudioDir}`)
      }

      this.logger.info({ dir: options.mergedAudioDir }, 'Scanning for merged MP3 files')

      // Step 1: Discover merged MP3 files
      const mergedFiles = await this.discoverMergedFiles(options.mergedAudioDir)

      if (mergedFiles.length === 0) {
        throw new Error(`No merged MP3 files found in ${options.mergedAudioDir}`)
      }

      this.logger.info({ count: mergedFiles.length }, 'Found merged files')

      // Step 2: Build conversion tasks
      const conversions = mergedFiles.map(file => ({
        inputPath: file,
        outputPath: this.buildOutputPath(file, options.outputDir),
        metadata: options.metadataSource?.[this.getBasename(file)] ?? {}
      }))

      // Step 3: Dry-run preview
      if (options.dryRun) {
        this.logger.info({ count: conversions.length }, 'DRY RUN: Would convert files')
        conversions.forEach((conv, idx) => {
          this.logger.info(
            { index: idx, input: conv.inputPath, output: conv.outputPath },
            `[${idx + 1}] ${this.getBasename(conv.inputPath)} → ${this.getBasename(conv.outputPath)}`
          )
        })

        return {
          timestamp: startTime,
          inputDirectory: options.mergedAudioDir,
          outputDirectory: options.outputDir,
          totalFiles: conversions.length,
          successCount: 0,
          failureCount: 0,
          results: [],
          dryRun: true,
          errors: []
        }
      }

      // Step 4: Ensure output directory exists
      await this.ensureOutputDirectory(options.outputDir)

      // Step 5: Execute conversions
      this.logger.info({ count: conversions.length }, 'Starting MP4 conversion batch')
      const results = await this.mp4ConversionService.convertBatch(conversions)

      // Step 6: Validate results
      const successCount = results.filter(r => !r.error).length
      const failureCount = results.filter(r => r.error).length

      if (failureCount > 0) {
        results
          .filter(r => r.error)
          .forEach(r => {
            errors.push(`${this.getBasename(r.inputPath)}: ${r.error}`)
          })
      }

      this.logger.info(
        { success: successCount, failure: failureCount, duration: Date.now() - startTime },
        'MP4 conversion batch complete'
      )

      return {
        timestamp: startTime,
        inputDirectory: options.mergedAudioDir,
        outputDirectory: options.outputDir,
        totalFiles: conversions.length,
        successCount,
        failureCount,
        results,
        dryRun: false,
        errors
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error({ error }, 'Pipeline execution failed')
      errors.push(msg)

      return {
        timestamp: startTime,
        inputDirectory: options.mergedAudioDir,
        outputDirectory: options.outputDir,
        totalFiles: 0,
        successCount: 0,
        failureCount: 1,
        results: [],
        dryRun: options.dryRun ?? false,
        errors
      }
    }
  }

  /**
   * Discover all merged MP3 files in a directory
   * Returns sorted absolute paths
   */
  private async discoverMergedFiles(dir: string): Promise<string[]> {
    const files: string[] = []

    try {
      // Use shell command to find .mp3 files (more reliable than Bun.glob)
      const result = await Bun.$`find ${dir} -maxdepth 1 -name "*.mp3" -type f`.text()

      if (result && result.trim()) {
        const lines = result.trim().split('\n')
        lines.forEach(line => {
          if (line && line.length > 0) {
            files.push(line)
          }
        })
      }

      return files.sort()
    } catch (error) {
      this.logger.error({ dir, error }, 'Failed to discover files')
      return []
    }
  }

  /**
   * Build output file path from input path
   * Converts .mp3 → .m4a, preserving directory structure
   */
  private buildOutputPath(inputPath: string, outputDir: string): string {
    const basename = this.getBasename(inputPath)
    const outputName = basename.replace(/\.mp3$/i, '.m4a')
    return `${outputDir}/${outputName}`
  }

  /**
   * Extract filename from full path
   */
  private getBasename(path: string): string {
    return path.split('/').pop() ?? path
  }

  /**
   * Ensure output directory exists, creating if necessary
   */
  private async ensureOutputDirectory(dir: string): Promise<void> {
    try {
      const dirHandle = Bun.file(dir)
      if (!(await dirHandle.exists())) {
        await Bun.$`mkdir -p ${dir}`.quiet()
        this.logger.info({ dir }, 'Created output directory')
      }
    } catch (error) {
      this.logger.error({ dir, error }, 'Failed to create output directory')
      throw error
    }
  }
}
