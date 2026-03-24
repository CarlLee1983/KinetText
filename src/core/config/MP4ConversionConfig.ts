/**
 * MP4 conversion configuration schema
 * Manages settings for M4A conversion (bitrate, concurrency, output format, etc.)
 */

import { z } from 'zod'
import { getLogger } from '../utils/logger'

const logger = getLogger('MP4ConversionConfig')

/**
 * Schema for validating MP4 conversion configuration
 * Supports environment variables and .env file loading (Bun auto-loads .env)
 */
const MP4ConfigSchema = z.object({
  bitrate: z.number().int().min(96).max(320),
  outputFormat: z.enum(['m4a', 'mp4']),
  videoBackground: z.enum(['none', 'black', 'image']),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
  maxConcurrency: z.number().int().min(1).max(8),
  outputDirectory: z.string().min(1),
  retryMaxAttempts: z.number().int().min(1).max(10)
})

/**
 * MP4 conversion configuration interface
 * All fields are readonly to enforce immutability per CLAUDE.md rules
 */
export interface MP4ConversionConfig {
  /** Output bitrate in kbps (96-320; default 256 AAC) */
  readonly bitrate: number
  /** Output format: m4a (audio-only) or mp4 (with video) */
  readonly outputFormat: 'm4a' | 'mp4'
  /** Video background style when outputFormat='mp4' */
  readonly videoBackground: 'none' | 'black' | 'image'
  /** Video width in pixels (default 1920) */
  readonly videoWidth: number
  /** Video height in pixels (default 1080) */
  readonly videoHeight: number
  /** Maximum concurrent conversions (1-8; default 2 to avoid overload) */
  readonly maxConcurrency: number
  /** Output directory for M4A files (created if missing) */
  readonly outputDirectory: string
  /** Max retry attempts for transient FFmpeg errors (default 3) */
  readonly retryMaxAttempts: number
}

/**
 * Load MP4ConversionConfig from environment variables, .env, and defaults
 * Environment variables take precedence over .env file which takes precedence over defaults
 */
export async function loadMP4Config(): Promise<MP4ConversionConfig> {
  const bitrate = parseInt(process.env.MP4_BITRATE ?? '256', 10)
  const outputFormat = (process.env.MP4_OUTPUT_FORMAT ?? 'm4a') as 'm4a' | 'mp4'
  const videoBackground = (process.env.MP4_VIDEO_BACKGROUND ?? 'none') as 'none' | 'black' | 'image'
  const videoWidth = parseInt(process.env.MP4_VIDEO_WIDTH ?? '1920', 10)
  const videoHeight = parseInt(process.env.MP4_VIDEO_HEIGHT ?? '1080', 10)
  const maxConcurrency = parseInt(process.env.MP4_MAX_CONCURRENCY ?? '2', 10)
  const outputDirectory = process.env.MP4_OUTPUT_DIRECTORY ?? './output/m4a'
  const retryMaxAttempts = parseInt(process.env.MP4_RETRY_MAX_ATTEMPTS ?? '3', 10)

  const config: MP4ConversionConfig = {
    bitrate,
    outputFormat,
    videoBackground,
    videoWidth,
    videoHeight,
    maxConcurrency,
    outputDirectory,
    retryMaxAttempts
  }

  // Validate configuration schema
  try {
    const validated = MP4ConfigSchema.parse(config)
    logger.debug({ config: validated }, 'MP4 configuration loaded and validated')
    return validated as MP4ConversionConfig
  } catch (error) {
    const zodError = error instanceof z.ZodError ? error : null
    if (zodError) {
      const issues = zodError.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      throw new Error(`Invalid MP4 configuration: ${issues}`)
    }
    throw error
  }
}

/**
 * Validate individual configuration values
 * Exported for testing or runtime validation without full config load
 */
export function validateBitrate(bitrate: number): { valid: boolean; error?: string } {
  if (bitrate < 96 || bitrate > 320) {
    return { valid: false, error: `bitrate must be 96-320 kbps, got ${bitrate}` }
  }
  return { valid: true }
}

export function validateConcurrency(concurrency: number): { valid: boolean; error?: string } {
  if (concurrency < 1 || concurrency > 8) {
    return { valid: false, error: `maxConcurrency must be 1-8, got ${concurrency}` }
  }
  return { valid: true }
}
