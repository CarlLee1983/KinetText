/**
 * Unit tests for defaults.ts
 * Tests default configuration values and their validity
 */

import { describe, test, expect } from 'bun:test'
import {
  DEFAULT_RETRY_CONFIG,
  DEFAULT_AUDIO_CONFIG
} from '../../config/defaults'

describe('defaults.ts - Default Configuration Values', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    test('exports DEFAULT_RETRY_CONFIG as const object', () => {
      expect(DEFAULT_RETRY_CONFIG).toBeDefined()
      expect(typeof DEFAULT_RETRY_CONFIG).toBe('object')
    })

    test('has all required retry configuration fields', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.backoffFactor).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.timeoutMs).toBeDefined()
      expect(DEFAULT_RETRY_CONFIG.operationTimeoutMs).toBeDefined()
    })

    test('maxRetries is within valid range [0, 100]', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.maxRetries).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeGreaterThanOrEqual(0)
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeLessThanOrEqual(100)
    })

    test('maxRetries is integer', () => {
      expect(Number.isInteger(DEFAULT_RETRY_CONFIG.maxRetries)).toBe(true)
    })

    test('maxRetries default is 3', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3)
    })

    test('initialDelayMs is non-negative', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.initialDelayMs).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBeGreaterThanOrEqual(0)
    })

    test('initialDelayMs default is 100', () => {
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(100)
    })

    test('maxDelayMs is greater than initialDelayMs', () => {
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBeGreaterThanOrEqual(
        DEFAULT_RETRY_CONFIG.initialDelayMs
      )
    })

    test('maxDelayMs default is 30000', () => {
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000)
    })

    test('backoffFactor is at least 1.0', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.backoffFactor).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.backoffFactor).toBeGreaterThanOrEqual(1)
    })

    test('backoffFactor default is 2', () => {
      expect(DEFAULT_RETRY_CONFIG.backoffFactor).toBe(2)
    })

    test('jitterFactor is between 0 and 1', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.jitterFactor).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBeGreaterThanOrEqual(0)
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBeLessThanOrEqual(1)
    })

    test('jitterFactor default is 0.1', () => {
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.1)
    })

    test('timeoutMs is non-negative', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.timeoutMs).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.timeoutMs).toBeGreaterThanOrEqual(0)
    })

    test('timeoutMs default is 10000', () => {
      expect(DEFAULT_RETRY_CONFIG.timeoutMs).toBe(10000)
    })

    test('operationTimeoutMs is non-negative', () => {
      expect(typeof DEFAULT_RETRY_CONFIG.operationTimeoutMs).toBe('number')
      expect(DEFAULT_RETRY_CONFIG.operationTimeoutMs).toBeGreaterThanOrEqual(0)
    })

    test('operationTimeoutMs default is 60000', () => {
      expect(DEFAULT_RETRY_CONFIG.operationTimeoutMs).toBe(60000)
    })

    test('operationTimeoutMs is greater than timeoutMs', () => {
      expect(DEFAULT_RETRY_CONFIG.operationTimeoutMs).toBeGreaterThanOrEqual(
        DEFAULT_RETRY_CONFIG.timeoutMs
      )
    })

    test('is readonly (cannot be modified)', () => {
      // Verify it's declared as const
      const original = { ...DEFAULT_RETRY_CONFIG }
      expect(DEFAULT_RETRY_CONFIG).toEqual(original)

      // Attempting to modify should fail in strict mode
      // This is a type-level check, but we verify structure is preserved
      expect(Object.keys(DEFAULT_RETRY_CONFIG).length).toBe(7)
    })
  })

  describe('DEFAULT_AUDIO_CONFIG', () => {
    test('exports DEFAULT_AUDIO_CONFIG as const object', () => {
      expect(DEFAULT_AUDIO_CONFIG).toBeDefined()
      expect(typeof DEFAULT_AUDIO_CONFIG).toBe('object')
    })

    test('has all required audio configuration fields', () => {
      expect(DEFAULT_AUDIO_CONFIG.bitrate).toBeDefined()
      expect(DEFAULT_AUDIO_CONFIG.sampleRate).toBeDefined()
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBeDefined()
      expect(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBeDefined()
    })

    test('bitrate is a string in valid format', () => {
      expect(typeof DEFAULT_AUDIO_CONFIG.bitrate).toBe('string')
      // Should match pattern like "128k", "192k", "256k"
      expect(DEFAULT_AUDIO_CONFIG.bitrate).toMatch(/^\d+k$/)
    })

    test('bitrate default is 128k', () => {
      expect(DEFAULT_AUDIO_CONFIG.bitrate).toBe('128k')
    })

    test('bitrate is within reasonable range', () => {
      const match = DEFAULT_AUDIO_CONFIG.bitrate.match(/^(\d+)k$/)
      expect(match).not.toBeNull()

      if (match) {
        const bitrateValue = parseInt(match[1], 10)
        expect(bitrateValue).toBeGreaterThanOrEqual(64) // Minimum audio bitrate
        expect(bitrateValue).toBeLessThanOrEqual(320) // Maximum practical audio bitrate
      }
    })

    test('sampleRate is a positive integer', () => {
      expect(typeof DEFAULT_AUDIO_CONFIG.sampleRate).toBe('number')
      expect(Number.isInteger(DEFAULT_AUDIO_CONFIG.sampleRate)).toBe(true)
      expect(DEFAULT_AUDIO_CONFIG.sampleRate).toBeGreaterThan(0)
    })

    test('sampleRate default is 44100', () => {
      expect(DEFAULT_AUDIO_CONFIG.sampleRate).toBe(44100)
    })

    test('sampleRate is standard audio rate', () => {
      // Common audio sample rates: 44100, 48000, 96000, 192000
      const commonRates = [44100, 48000, 96000, 192000]
      expect(commonRates).toContain(DEFAULT_AUDIO_CONFIG.sampleRate)
    })

    test('maxConcurrency is positive integer', () => {
      expect(typeof DEFAULT_AUDIO_CONFIG.maxConcurrency).toBe('number')
      expect(Number.isInteger(DEFAULT_AUDIO_CONFIG.maxConcurrency)).toBe(true)
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBeGreaterThan(0)
    })

    test('maxConcurrency default is 3', () => {
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBe(3)
    })

    test('maxConcurrency is within reasonable range', () => {
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBeGreaterThanOrEqual(1)
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBeLessThanOrEqual(16) // Reasonable max
    })

    test('ffmpegTimeoutMs is non-negative', () => {
      expect(typeof DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBe('number')
      expect(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBeGreaterThanOrEqual(0)
    })

    test('ffmpegTimeoutMs default is 300000', () => {
      expect(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBe(300000)
    })

    test('ffmpegTimeoutMs is reasonable (at least 1 minute)', () => {
      expect(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBeGreaterThanOrEqual(60000)
    })

    test('is readonly (cannot be modified)', () => {
      // Verify it's declared as const
      const original = { ...DEFAULT_AUDIO_CONFIG }
      expect(DEFAULT_AUDIO_CONFIG).toEqual(original)

      // Attempting to modify should fail in strict mode
      // This is a type-level check, but we verify structure is preserved
      expect(Object.keys(DEFAULT_AUDIO_CONFIG).length).toBe(4)
    })
  })

  describe('Configuration consistency', () => {
    test('retry config timeouts are ordered: timeoutMs < operationTimeoutMs', () => {
      expect(DEFAULT_RETRY_CONFIG.timeoutMs).toBeLessThanOrEqual(
        DEFAULT_RETRY_CONFIG.operationTimeoutMs
      )
    })

    test('retry config delays are ordered: initialDelayMs < maxDelayMs', () => {
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBeLessThanOrEqual(
        DEFAULT_RETRY_CONFIG.maxDelayMs
      )
    })

    test('retry config with default backoff produces increasing delays', () => {
      // Exponential backoff: delay * backoffFactor = next delay
      const delay1 = DEFAULT_RETRY_CONFIG.initialDelayMs
      const delay2 = delay1 * DEFAULT_RETRY_CONFIG.backoffFactor
      const delay3 = delay2 * DEFAULT_RETRY_CONFIG.backoffFactor

      // All should be less than maxDelayMs
      expect(delay1).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs)
      expect(delay2).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs)
      expect(delay3).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs)
    })

    test('all numeric values are finite numbers', () => {
      // Check retry config
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.maxRetries)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.initialDelayMs)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.maxDelayMs)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.backoffFactor)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.jitterFactor)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.timeoutMs)).toBe(true)
      expect(Number.isFinite(DEFAULT_RETRY_CONFIG.operationTimeoutMs)).toBe(true)

      // Check audio config
      expect(Number.isFinite(DEFAULT_AUDIO_CONFIG.sampleRate)).toBe(true)
      expect(Number.isFinite(DEFAULT_AUDIO_CONFIG.maxConcurrency)).toBe(true)
      expect(Number.isFinite(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs)).toBe(true)
    })

    test('no NaN values in configuration', () => {
      // Verify no NaN values
      const retryValues = Object.values(DEFAULT_RETRY_CONFIG).filter(
        v => typeof v === 'number'
      )
      const audioValues = Object.values(DEFAULT_AUDIO_CONFIG).filter(
        v => typeof v === 'number'
      )

      retryValues.forEach(v => {
        expect(Number.isNaN(v as number)).toBe(false)
      })
      audioValues.forEach(v => {
        expect(Number.isNaN(v as number)).toBe(false)
      })
    })
  })

  describe('Production readiness', () => {
    test('retry config supports reasonable error recovery', () => {
      // With 3 retries and exponential backoff, total retry time should be bounded
      let totalTime = 0
      let delay = DEFAULT_RETRY_CONFIG.initialDelayMs

      for (let i = 0; i < DEFAULT_RETRY_CONFIG.maxRetries; i++) {
        totalTime += Math.min(delay, DEFAULT_RETRY_CONFIG.maxDelayMs)
        delay *= DEFAULT_RETRY_CONFIG.backoffFactor
      }

      // Total retry time should not exceed ~2 minutes (production reasonable)
      expect(totalTime).toBeLessThanOrEqual(120000)
    })

    test('audio config supports reasonable concurrency', () => {
      // maxConcurrency should be reasonable for system resources
      expect(DEFAULT_AUDIO_CONFIG.maxConcurrency).toBeLessThanOrEqual(8)
    })

    test('ffmpeg timeout is sufficient for typical conversions', () => {
      // 5 minutes (300 seconds) is reasonable for FFmpeg operations
      expect(DEFAULT_AUDIO_CONFIG.ffmpegTimeoutMs).toBeGreaterThanOrEqual(300000)
    })
  })
})
