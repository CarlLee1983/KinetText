/**
 * Unit tests for MP4ConversionConfig
 * Tests schema validation, environment variable loading, and defaults
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { loadMP4Config, validateBitrate, validateConcurrency } from '../../core/config/MP4ConversionConfig'
import type { MP4ConversionConfig } from '../../core/config/MP4ConversionConfig'

describe('MP4ConversionConfig', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    // Save original environment
    originalEnv = {
      MP4_BITRATE: process.env.MP4_BITRATE,
      MP4_OUTPUT_FORMAT: process.env.MP4_OUTPUT_FORMAT,
      MP4_VIDEO_BACKGROUND: process.env.MP4_VIDEO_BACKGROUND,
      MP4_VIDEO_WIDTH: process.env.MP4_VIDEO_WIDTH,
      MP4_VIDEO_HEIGHT: process.env.MP4_VIDEO_HEIGHT,
      MP4_MAX_CONCURRENCY: process.env.MP4_MAX_CONCURRENCY,
      MP4_OUTPUT_DIRECTORY: process.env.MP4_OUTPUT_DIRECTORY,
      MP4_RETRY_MAX_ATTEMPTS: process.env.MP4_RETRY_MAX_ATTEMPTS
    }
  })

  describe('loadMP4Config() - Load from environment', () => {
    test('loads default configuration when no env vars set', async () => {
      // Clear environment
      delete process.env.MP4_BITRATE
      delete process.env.MP4_MAX_CONCURRENCY
      delete process.env.MP4_OUTPUT_DIRECTORY

      const config = await loadMP4Config()

      expect(config.bitrate).toBe(256) // Default AAC bitrate
      expect(config.outputFormat).toBe('m4a') // Default audio-only
      expect(config.videoBackground).toBe('none')
      expect(config.videoWidth).toBe(1920)
      expect(config.videoHeight).toBe(1080)
      expect(config.maxConcurrency).toBe(2)
      expect(config.outputDirectory).toBe('./output/m4a')
      expect(config.retryMaxAttempts).toBe(3)
    })

    test('loads custom bitrate from MP4_BITRATE env var', async () => {
      process.env.MP4_BITRATE = '192'

      const config = await loadMP4Config()
      expect(config.bitrate).toBe(192)
    })

    test('loads custom concurrency from MP4_MAX_CONCURRENCY env var', async () => {
      process.env.MP4_MAX_CONCURRENCY = '4'

      const config = await loadMP4Config()
      expect(config.maxConcurrency).toBe(4)
    })

    test('loads custom output directory from MP4_OUTPUT_DIRECTORY env var', async () => {
      process.env.MP4_OUTPUT_DIRECTORY = '/custom/m4a/path'

      const config = await loadMP4Config()
      expect(config.outputDirectory).toBe('/custom/m4a/path')
    })

    test('loads MP4 output format when specified', async () => {
      process.env.MP4_OUTPUT_FORMAT = 'mp4'

      const config = await loadMP4Config()
      expect(config.outputFormat).toBe('mp4')
    })

    test('throws error for invalid bitrate (below minimum)', async () => {
      process.env.MP4_BITRATE = '32' // Below 96 minimum

      await expect(loadMP4Config()).rejects.toThrow()
    })

    test('throws error for invalid bitrate (above maximum)', async () => {
      process.env.MP4_BITRATE = '500' // Above 320 maximum

      await expect(loadMP4Config()).rejects.toThrow()
    })

    test('throws error for invalid concurrency (too high)', async () => {
      process.env.MP4_MAX_CONCURRENCY = '16' // Above 8 maximum

      await expect(loadMP4Config()).rejects.toThrow()
    })

    test('throws error for invalid concurrency (too low)', async () => {
      process.env.MP4_MAX_CONCURRENCY = '0' // Below 1 minimum

      await expect(loadMP4Config()).rejects.toThrow()
    })

    test('error message includes field name and constraint', async () => {
      process.env.MP4_BITRATE = '1000'

      try {
        await loadMP4Config()
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('bitrate')
        }
      }
    })

    test('loads all environment variables together', async () => {
      process.env.MP4_BITRATE = '192'
      process.env.MP4_MAX_CONCURRENCY = '4'
      process.env.MP4_OUTPUT_FORMAT = 'mp4'
      process.env.MP4_OUTPUT_DIRECTORY = '/custom/path'
      process.env.MP4_RETRY_MAX_ATTEMPTS = '5'

      const config = await loadMP4Config()

      expect(config.bitrate).toBe(192)
      expect(config.maxConcurrency).toBe(4)
      expect(config.outputFormat).toBe('mp4')
      expect(config.outputDirectory).toBe('/custom/path')
      expect(config.retryMaxAttempts).toBe(5)
    })
  })

  describe('validateBitrate()', () => {
    test('validates bitrate 96 (minimum)', () => {
      const result = validateBitrate(96)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test('validates bitrate 256 (typical)', () => {
      const result = validateBitrate(256)
      expect(result.valid).toBe(true)
    })

    test('validates bitrate 320 (maximum)', () => {
      const result = validateBitrate(320)
      expect(result.valid).toBe(true)
    })

    test('rejects bitrate below 96', () => {
      const result = validateBitrate(64)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('96-320')
    })

    test('rejects bitrate above 320', () => {
      const result = validateBitrate(500)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('96-320')
    })

    test('error message includes actual value', () => {
      const result = validateBitrate(500)
      expect(result.error).toContain('500')
    })
  })

  describe('validateConcurrency()', () => {
    test('validates concurrency 1 (minimum)', () => {
      const result = validateConcurrency(1)
      expect(result.valid).toBe(true)
    })

    test('validates concurrency 2 (typical)', () => {
      const result = validateConcurrency(2)
      expect(result.valid).toBe(true)
    })

    test('validates concurrency 8 (maximum)', () => {
      const result = validateConcurrency(8)
      expect(result.valid).toBe(true)
    })

    test('rejects concurrency below 1', () => {
      const result = validateConcurrency(0)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('1-8')
    })

    test('rejects concurrency above 8', () => {
      const result = validateConcurrency(16)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('1-8')
    })
  })

  describe('Configuration interface type safety', () => {
    test('config type ensures readonly fields', async () => {
      const config = await loadMP4Config()

      // Verify it's the expected type
      expect(config.bitrate).toBeDefined()
      expect(config.outputFormat).toBeDefined()
      expect(config.maxConcurrency).toBeDefined()

      // readonly fields should not be modifiable (TypeScript compile-time check)
      // This is verified at compile time, not runtime
    })

    test('supports all enum variants for outputFormat', async () => {
      process.env.MP4_OUTPUT_FORMAT = 'm4a'
      const config1 = await loadMP4Config()
      expect(config1.outputFormat).toBe('m4a')

      process.env.MP4_OUTPUT_FORMAT = 'mp4'
      const config2 = await loadMP4Config()
      expect(config2.outputFormat).toBe('mp4')
    })

    test('supports all enum variants for videoBackground', async () => {
      const formats = ['none', 'black', 'image']

      for (const fmt of formats) {
        process.env.MP4_VIDEO_BACKGROUND = fmt
        const config = await loadMP4Config()
        expect(config.videoBackground).toBe(fmt)
      }
    })
  })
})
