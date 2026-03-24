/**
 * Audio conversion service
 * Converts audio files (WAV, AAC, OGG, FLAC) to MP3 using FFmpeg via Bun.$
 * Integrates with RetryService for resilient conversion with backoff
 */

import { $ } from 'bun'
import { parseFile } from 'music-metadata'
import path from 'node:path'
import { unlink } from 'node:fs/promises'
import pLimit from 'p-limit'
import { RetryService } from './RetryService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import { RetryConfig } from '../../config/RetryConfig'
import { createLogger } from '../utils/logger'
import type {
  ConversionResult,
  ConversionBatchResult,
  ConversionError,
  AudioMetadata,
} from '../types/audio'

/** Map of file extensions to format names */
const FORMAT_MAP: Readonly<Record<string, string>> = {
  '.wav': 'WAV',
  '.aac': 'AAC',
  '.ogg': 'OGG',
  '.flac': 'FLAC',
  '.mp3': 'MP3',
  '.m4a': 'M4A',
  '.wma': 'WMA',
  '.opus': 'OPUS',
}

/**
 * Injectable shell executor type.
 * In production: wraps Bun.$
 * In tests: can be replaced with a controlled mock
 */
export type ShellExecutor = (
  inputPath: string,
  outputPath: string,
  bitrate: string,
  sampleRate: number
) => Promise<void>

/**
 * Injectable metadata reader type.
 * In production: wraps music-metadata parseFile
 * In tests: returns controlled metadata
 */
export type MetadataReader = (filePath: string) => Promise<AudioMetadata>

/**
 * Injectable FFmpeg availability checker type.
 */
export type FfmpegChecker = () => Promise<void>

/**
 * Dependencies for AudioConvertService (enables full testability)
 */
export interface AudioConvertServiceDeps {
  retryService?: RetryService
  shellExecutor?: ShellExecutor
  metadataReader?: MetadataReader
  ffmpegChecker?: FfmpegChecker
}

/**
 * Default Bun.$ shell executor for production use
 */
const defaultShellExecutor: ShellExecutor = async (
  inputPath,
  outputPath,
  bitrate,
  sampleRate
) => {
  const result = await $`ffmpeg -y -i ${inputPath} -codec:a libmp3lame -b:a ${bitrate} -ar ${sampleRate} ${outputPath}`.quiet()
  if (result.exitCode !== 0) {
    const stderrText = result.stderr.toString().substring(0, 200)
    throw new Error(`FFmpeg conversion failed (exit ${result.exitCode}): ${stderrText}`)
  }
}

/**
 * Default metadata reader using music-metadata
 */
const defaultMetadataReader: MetadataReader = async (filePath) => {
  const meta = await parseFile(filePath)
  return {
    duration: meta.format.duration ?? 0,
    codec: meta.format.codec ?? meta.format.container ?? 'UNKNOWN',
    bitrate: meta.format.bitrate ?? 0,
    sampleRate: meta.format.sampleRate ?? 0,
  }
}

/**
 * Default FFmpeg availability checker
 */
const defaultFfmpegChecker: FfmpegChecker = async () => {
  try {
    const result = await $`ffmpeg -version`.quiet()
    if (result.exitCode !== 0) {
      throw new Error('FFmpeg not found in PATH. Install: brew install ffmpeg')
    }
  } catch (err) {
    throw new Error('FFmpeg not found in PATH. Install: brew install ffmpeg')
  }
}

/**
 * Core audio conversion service.
 * Converts audio files to MP3 format via FFmpeg subprocess (Bun.$).
 * Wraps each conversion in RetryService for resilience.
 */
export class AudioConvertService {
  private readonly config: AudioConvertConfig
  private readonly retryService: RetryService
  private readonly shellExecutor: ShellExecutor
  private readonly metadataReader: MetadataReader
  private readonly ffmpegChecker: FfmpegChecker
  private readonly logger = createLogger('audio-convert')

  constructor(
    config: AudioConvertConfig = new AudioConvertConfig(),
    deps: AudioConvertServiceDeps = {}
  ) {
    this.config = config
    const retryConfig = new RetryConfig({
      timeoutMs: config.ffmpegTimeoutMs,
      operationTimeoutMs: config.ffmpegTimeoutMs * 2,
    })
    this.retryService = deps.retryService ?? new RetryService(retryConfig)
    this.shellExecutor = deps.shellExecutor ?? defaultShellExecutor
    this.metadataReader = deps.metadataReader ?? defaultMetadataReader
    this.ffmpegChecker = deps.ffmpegChecker ?? defaultFfmpegChecker
  }

  /**
   * Verify FFmpeg is available in the system PATH.
   * @throws Error with install instructions if FFmpeg is missing
   */
  async checkFfmpegAvailable(): Promise<void> {
    await this.ffmpegChecker()
  }

  /**
   * Static version of checkFfmpegAvailable for convenience.
   * @throws Error with install instructions if FFmpeg is missing
   */
  static async checkFfmpegAvailable(): Promise<void> {
    await defaultFfmpegChecker()
  }

  /**
   * Convert a single audio file to MP3 format.
   * The conversion is wrapped in RetryService for automatic retry on transient failures.
   * On permanent failure, any partial output file is cleaned up.
   *
   * @param inputPath - Absolute path to the source audio file
   * @param outputPath - Absolute path for the output MP3 file
   * @returns ConversionResult with metadata and timing information
   * @throws Error if conversion fails after all retries
   */
  async convertToMp3(inputPath: string, outputPath: string): Promise<ConversionResult> {
    const startMs = Date.now()

    const retryResult = await this.retryService.execute(
      () => this.runFfmpegConversion(inputPath, outputPath),
      `convert:${path.basename(inputPath)}`
    )

    if (!retryResult.success) {
      await this.cleanupPartialFile(outputPath)
      throw retryResult.error ?? new Error(`Failed to convert ${inputPath}`)
    }

    const durationMs = Date.now() - startMs
    const outputMetadata = await this.getMetadata(outputPath)

    return {
      inputPath,
      outputPath,
      durationMs,
      inputFormat: this.detectFormat(inputPath),
      outputMetadata,
    }
  }

  /**
   * Convert multiple audio files to MP3 in parallel, respecting maxConcurrency.
   * Partial failures do not abort remaining conversions.
   *
   * @param files - Array of { input, output } path pairs
   * @returns ConversionBatchResult with per-file results and aggregate counts
   */
  async convertBatch(
    files: ReadonlyArray<{ input: string; output: string }>
  ): Promise<ConversionBatchResult> {
    const startMs = Date.now()
    const limit = pLimit(this.config.maxConcurrency)

    const settled = await Promise.allSettled(
      files.map(({ input, output }) =>
        limit(() => this.convertToMp3(input, output))
      )
    )

    let succeeded = 0
    let failed = 0
    const results: Array<ConversionResult | ConversionError> = []

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i]
      if (outcome.status === 'fulfilled') {
        succeeded++
        results.push(outcome.value)
      } else {
        failed++
        const conversionError: ConversionError = {
          inputPath: files[i].input,
          error: outcome.reason instanceof Error
            ? outcome.reason
            : new Error(String(outcome.reason)),
          retryAttempts: 0,
        }
        results.push(conversionError)
      }
    }

    return {
      total: files.length,
      succeeded,
      failed,
      results,
      totalDurationMs: Date.now() - startMs,
    }
  }

  /**
   * Extract metadata from an audio file using music-metadata.
   *
   * @param filePath - Path to the audio file
   * @returns AudioMetadata with duration, codec, bitrate, sampleRate
   */
  async getMetadata(filePath: string): Promise<AudioMetadata> {
    return this.metadataReader(filePath)
  }

  /**
   * Execute FFmpeg conversion using the configured shell executor.
   */
  private async runFfmpegConversion(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    await this.shellExecutor(inputPath, outputPath, this.config.bitrate, this.config.sampleRate)
  }

  /**
   * Remove a partial output file after failed conversion.
   * Silently ignores ENOENT (file not found).
   */
  private async cleanupPartialFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath)
      this.logger.debug({ filePath }, 'Cleaned up partial output file')
    } catch (err) {
      // Ignore "file not found" -- nothing to clean up
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ filePath, err }, 'Failed to clean up partial file')
      }
    }
  }

  /**
   * Detect input audio format from file extension.
   * Returns uppercase format name (e.g., '.wav' -> 'WAV').
   */
  private detectFormat(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    const fromMap = FORMAT_MAP[ext]
    if (fromMap) return fromMap
    const fromExt = ext.substring(1).toUpperCase()
    return fromExt.length > 0 ? fromExt : 'UNKNOWN'
  }
}
