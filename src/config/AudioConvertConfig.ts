/**
 * Audio conversion configuration management
 * Handles configuration loading, validation, and immutable defaults
 */

import { DEFAULT_AUDIO_CONFIG } from './defaults'
import type { AudioConvertConfigOptions } from '../core/types/audio'

/** Valid sample rates supported by FFmpeg libmp3lame */
const VALID_SAMPLE_RATES = [22050, 44100, 48000] as const

/**
 * Immutable configuration for the audio conversion service.
 * All properties are readonly to enforce immutability.
 */
export class AudioConvertConfig {
  /** Output MP3 bitrate (e.g., '128k', '192k', '320k') */
  readonly bitrate: string
  /** Output sample rate in Hz */
  readonly sampleRate: number
  /** Maximum number of concurrent FFmpeg processes (1-16) */
  readonly maxConcurrency: number
  /** Per-file FFmpeg timeout in milliseconds */
  readonly ffmpegTimeoutMs: number

  /**
   * Create a new AudioConvertConfig instance
   * @param overrides Partial configuration overrides
   * @throws Error if maxConcurrency is outside 1-16 or sampleRate is invalid
   */
  constructor(overrides: AudioConvertConfigOptions = {}) {
    this.bitrate = overrides.bitrate ?? DEFAULT_AUDIO_CONFIG.bitrate
    this.sampleRate = this.validateSampleRate(
      overrides.sampleRate ?? DEFAULT_AUDIO_CONFIG.sampleRate
    )
    this.maxConcurrency = this.validateMaxConcurrency(
      overrides.maxConcurrency ?? DEFAULT_AUDIO_CONFIG.maxConcurrency
    )
    this.ffmpegTimeoutMs = Math.max(
      0,
      overrides.ffmpegTimeoutMs ?? DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs
    )
  }

  /**
   * Load configuration from environment variables.
   * Environment variable names: AUDIO_BITRATE, AUDIO_SAMPLE_RATE,
   * AUDIO_MAX_CONCURRENCY, AUDIO_FFMPEG_TIMEOUT_MS
   */
  static fromEnvironment(): AudioConvertConfig {
    return new AudioConvertConfig({
      bitrate: process.env.AUDIO_BITRATE ?? undefined,
      sampleRate: process.env.AUDIO_SAMPLE_RATE
        ? parseInt(process.env.AUDIO_SAMPLE_RATE, 10)
        : undefined,
      maxConcurrency: process.env.AUDIO_MAX_CONCURRENCY
        ? parseInt(process.env.AUDIO_MAX_CONCURRENCY, 10)
        : undefined,
      ffmpegTimeoutMs: process.env.AUDIO_FFMPEG_TIMEOUT_MS
        ? parseInt(process.env.AUDIO_FFMPEG_TIMEOUT_MS, 10)
        : undefined,
    })
  }

  /**
   * Validate maxConcurrency is between 1 and 16
   */
  private validateMaxConcurrency(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 16) {
      throw new Error(
        `Invalid maxConcurrency: ${value}. Must be an integer between 1 and 16.`
      )
    }
    return value
  }

  /**
   * Validate sampleRate is one of the accepted values
   */
  private validateSampleRate(value: number): number {
    if (!(VALID_SAMPLE_RATES as readonly number[]).includes(value)) {
      throw new Error(
        `Invalid sampleRate: ${value}. Must be one of ${VALID_SAMPLE_RATES.join(', ')}.`
      )
    }
    return value
  }
}

export { DEFAULT_AUDIO_CONFIG }
