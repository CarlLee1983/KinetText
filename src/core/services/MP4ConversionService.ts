/**
 * MP4 conversion service
 * Handles MP3→M4A conversion with FFmpeg, retry logic, and concurrency control
 */

import pLimit from 'p-limit'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { MP4ConversionConfig } from '../config/MP4ConversionConfig'
import { MP4ConversionResult, MP4Metadata } from '../types/audio'
import { buildM4ACommand } from '../utils/ffmpeg-commands'
import { getLogger } from '../utils/logger'

const logger = getLogger('MP4ConversionService')

/**
 * Options for a single MP4 conversion task
 */
export interface ConvertOptions {
  /** Path to input MP3 file */
  readonly inputPath: string
  /** Path to output M4A file */
  readonly outputPath: string
  /** Optional metadata to embed in output */
  readonly metadata?: Readonly<MP4Metadata>
}

/**
 * MP4 conversion service
 * Converts MP3 files to M4A (AAC) format with metadata embedding
 * Uses RetryService for transient error recovery and p-limit for concurrency control
 */
export class MP4ConversionService {
  private readonly logger: any

  constructor(
    private readonly config: MP4ConversionConfig,
    private readonly retryService: RetryService,
    private readonly errorClassifier: AudioErrorClassifier
  ) {
    this.logger = getLogger('MP4ConversionService')
  }

  /**
   * Convert a single MP3 file to M4A
   * Wraps FFmpeg execution with retry logic for transient errors
   *
   * @param inputPath Path to input MP3 file
   * @param outputPath Path to output M4A file
   * @param metadata Optional metadata to embed
   * @returns MP4ConversionResult with output file details
   * @throws Error if input file missing or conversion permanently fails
   */
  async convert(
    inputPath: string,
    outputPath: string,
    metadata?: Readonly<MP4Metadata>
  ): Promise<MP4ConversionResult> {
    const startTime = Date.now()

    // Validate input file exists
    const inputFile = Bun.file(inputPath)
    if (!(await inputFile.exists())) {
      const error = `Input file not found: ${inputPath}`
      this.logger.error({ inputPath }, error)
      throw new Error(error)
    }

    try {
      // Build FFmpeg command
      const ffmpegArgs = buildM4ACommand(
        inputPath,
        outputPath,
        this.config.bitrate,
        metadata
      )

      // Execute conversion with retry logic
      await this.retryService.execute(
        async () => {
          this.logger.debug(
            { inputPath, outputPath, bitrate: this.config.bitrate },
            'Starting MP4 conversion'
          )

          // Execute FFmpeg via Bun.$
          // Join args with proper shell escaping
          const bashCmd = ffmpegArgs
            .map(arg => {
              // Quote arguments containing spaces or special chars
              if (arg.includes(' ') || arg.includes('"') || arg.includes('$')) {
                return `"${arg.replace(/"/g, '\\"')}"`
              }
              return arg
            })
            .join(' ')

          const process = await Bun.$`bash -c "ffmpeg ${bashCmd}"`.quiet()

          if (process.exitCode !== 0) {
            const stderr = process.stderr?.toString() ?? ''
            const error = `FFmpeg conversion failed: ${stderr.slice(0, 200)}`
            this.logger.error({ inputPath, stderr }, error)
            throw new Error(error)
          }

          this.logger.debug({ inputPath }, 'FFmpeg conversion succeeded')
        },
        {
          maxAttempts: this.config.retryMaxAttempts,
          backoff: 'exponential',
          classifier: this.errorClassifier
        }
      )

      // Verify output file exists and has size
      const outputFile = Bun.file(outputPath)
      const fileExists = await outputFile.exists()
      if (!fileExists) {
        throw new Error(`Output file not created: ${outputPath}`)
      }

      const fileSize = await outputFile.size
      if (fileSize === 0) {
        throw new Error(`Output file is empty: ${outputPath}`)
      }

      const durationMs = Date.now() - startTime

      // Return success result
      // Note: duration will be 0 for now; Phase 04-02 will wire music-metadata
      return {
        inputPath,
        outputPath,
        format: 'M4A',
        duration: 0,
        bitrate: this.config.bitrate,
        fileSize,
        metadata: metadata ?? {},
        timestamp: Date.now()
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(
        { inputPath, error: errorMsg },
        'MP4 conversion failed'
      )
      throw error
    }
  }

  /**
   * Convert multiple MP3 files to M4A in parallel
   * Respects maxConcurrency config to avoid system overload
   * Does not throw; all errors captured in result objects
   *
   * @param options Array of conversion tasks
   * @returns Array of MP4ConversionResult (one per input, with error field set on failure)
   */
  async convertBatch(
    options: ReadonlyArray<ConvertOptions>
  ): Promise<ReadonlyArray<MP4ConversionResult>> {
    this.logger.info(
      { count: options.length, concurrency: this.config.maxConcurrency },
      'Starting batch conversion'
    )

    const limiter = pLimit(this.config.maxConcurrency)

    const results = await Promise.all(
      Array.from(options).map(opt =>
        limiter(async () => {
          try {
            return await this.convert(
              opt.inputPath,
              opt.outputPath,
              opt.metadata
            )
          } catch (error) {
            // Catch errors and return result with error field set
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            this.logger.warn(
              { inputPath: opt.inputPath, error: errorMsg },
              'Conversion failed, returning error result'
            )

            return {
              inputPath: opt.inputPath,
              outputPath: opt.outputPath,
              format: 'M4A' as const,
              duration: 0,
              bitrate: this.config.bitrate,
              fileSize: 0,
              metadata: opt.metadata ?? {},
              timestamp: Date.now(),
              error: errorMsg
            }
          }
        })
      )
    )

    const successCount = results.filter(r => !r.error).length
    const failureCount = results.filter(r => r.error).length

    this.logger.info(
      { total: results.length, success: successCount, failure: failureCount },
      'Batch conversion complete'
    )

    return results
  }
}
