/**
 * MP4 conversion service
 * Handles MP3→M4A conversion with FFmpeg, retry logic, and concurrency control
 * Supports optional Go backend delegation with graceful fallback to Bun FFmpeg
 */

import pLimit from 'p-limit'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { MP4ConversionConfig } from '../config/MP4ConversionConfig'
import { MP4ConvertGoConfig } from '../config/MP4ConvertGoConfig'
import { MP4ConversionResult, MP4Metadata } from '../types/audio'
import { buildM4ACommand } from '../utils/ffmpeg-commands'
import { getLogger } from '../utils/logger'
import MP4ConvertGoWrapper from './MP4ConvertGoWrapper'

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
 * Optionally delegates to Go backend (kinetitext-mp4convert) with fallback to Bun
 */
export class MP4ConversionService {
  private readonly logger: any
  private goWrapper?: typeof MP4ConvertGoWrapper
  private goBackendInitialized: boolean = false

  constructor(
    private readonly config: MP4ConversionConfig,
    private readonly retryService: RetryService,
    private readonly errorClassifier: AudioErrorClassifier,
    private readonly goBackendConfig?: MP4ConvertGoConfig
  ) {
    this.logger = getLogger('MP4ConversionService')
  }

  /**
   * Initialize Go backend if enabled
   * This is called explicitly after construction to support lazy initialization
   * Gracefully falls back to Bun if Go backend is unavailable
   */
  async initGoBackend(): Promise<void> {
    if (!this.goBackendConfig?.enabled) {
      this.logger.debug('Go backend disabled for MP4 conversion')
      this.goBackendInitialized = true
      return
    }

    try {
      this.logger.debug({ config: this.goBackendConfig }, '初始化 MP4 Go 後端')

      // Check if binary is available
      const available = await MP4ConvertGoWrapper.isAvailable()
      if (!available) {
        this.logger.warn(
          { binaryPath: this.goBackendConfig.goBinaryPath },
          'MP4 Go 二進制不可用，回退至 Bun FFmpeg'
        )
        this.goBackendInitialized = true
        this.goWrapper = undefined
        return
      }

      // Set binary path if custom path provided
      if (this.goBackendConfig.goBinaryPath) {
        await MP4ConvertGoWrapper.init(this.goBackendConfig.goBinaryPath)
      }

      this.goWrapper = MP4ConvertGoWrapper
      this.goBackendInitialized = true
      this.logger.info('MP4 Go 後端初始化成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        { error: message },
        'MP4 Go 後端初始化失敗，回退至 Bun FFmpeg'
      )
      this.goBackendInitialized = true
      this.goWrapper = undefined
    }
  }

  /**
   * Convert a single MP3 file to M4A
   * Optionally delegates to Go backend if enabled and available
   * Falls back to Bun FFmpeg on Go failure or if Go not available
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
      // Try Go backend if initialized and available
      if (this.goBackendInitialized && this.goWrapper) {
        try {
          this.logger.debug(
            { inputPath, outputPath },
            'Go 後端轉換嘗試'
          )
          return await this.convertWithGo(inputPath, outputPath, metadata)
        } catch (goError) {
          const errorMsg = goError instanceof Error ? goError.message : String(goError)
          this.logger.warn(
            { inputPath, error: errorMsg },
            'Go 後端失敗，回退至 Bun FFmpeg'
          )
          // Fall through to Bun path
        }
      }

      // Fall back to Bun FFmpeg
      return await this.convertToBun(inputPath, outputPath, metadata)
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
   * Convert using Go backend
   * @private
   */
  private async convertWithGo(
    inputPath: string,
    outputPath: string,
    metadata?: Readonly<MP4Metadata>
  ): Promise<MP4ConversionResult> {
    if (!this.goWrapper) {
      throw new Error('Go wrapper not initialized')
    }

    const response = await this.goWrapper.convertMP4({
      inputFile: inputPath,
      outputFile: outputPath,
      bitrate: this.config.bitrate,
      metadata,
    })

    if (!response.success) {
      throw new Error(`Go conversion failed: ${response.error}`)
    }

    // Verify output file exists
    const outputFile = Bun.file(outputPath)
    const fileExists = await outputFile.exists()
    if (!fileExists) {
      throw new Error(`Output file not created: ${outputPath}`)
    }

    const fileSize = await outputFile.size
    if (fileSize === 0) {
      throw new Error(`Output file is empty: ${outputPath}`)
    }

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
  }

  /**
   * Convert using Bun FFmpeg
   * @private
   */
  private async convertToBun(
    inputPath: string,
    outputPath: string,
    metadata?: Readonly<MP4Metadata>
  ): Promise<MP4ConversionResult> {
    const startTime = Date.now()

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
            'Bun FFmpeg 轉換開始'
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

          this.logger.debug({ inputPath }, 'Bun FFmpeg 轉換完成')
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
