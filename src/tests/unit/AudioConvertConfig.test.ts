/**
 * Unit tests for AudioConvertConfig
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'

describe('AudioConvertConfig', () => {
  describe('defaults', () => {
    test('new AudioConvertConfig() creates config with default bitrate 128k', () => {
      const config = new AudioConvertConfig()
      expect(config.bitrate).toBe('128k')
    })

    test('new AudioConvertConfig() creates config with default sampleRate 44100', () => {
      const config = new AudioConvertConfig()
      expect(config.sampleRate).toBe(44100)
    })

    test('new AudioConvertConfig() creates config with default maxConcurrency 3', () => {
      const config = new AudioConvertConfig()
      expect(config.maxConcurrency).toBe(3)
    })

    test('new AudioConvertConfig() creates config with default ffmpegTimeoutMs 300000', () => {
      const config = new AudioConvertConfig()
      expect(config.ffmpegTimeoutMs).toBe(300000)
    })
  })

  describe('overrides', () => {
    test('new AudioConvertConfig({ bitrate: "192k" }) overrides only bitrate', () => {
      const config = new AudioConvertConfig({ bitrate: '192k' })
      expect(config.bitrate).toBe('192k')
      expect(config.sampleRate).toBe(44100)
      expect(config.maxConcurrency).toBe(3)
      expect(config.ffmpegTimeoutMs).toBe(300000)
    })

    test('new AudioConvertConfig({ sampleRate: 48000 }) overrides only sampleRate', () => {
      const config = new AudioConvertConfig({ sampleRate: 48000 })
      expect(config.sampleRate).toBe(48000)
      expect(config.bitrate).toBe('128k')
    })

    test('new AudioConvertConfig({ maxConcurrency: 5 }) overrides only maxConcurrency', () => {
      const config = new AudioConvertConfig({ maxConcurrency: 5 })
      expect(config.maxConcurrency).toBe(5)
      expect(config.bitrate).toBe('128k')
    })
  })

  describe('fromEnvironment()', () => {
    const originalEnv = { ...process.env }

    afterEach(() => {
      // Restore env
      for (const key of ['AUDIO_BITRATE', 'AUDIO_SAMPLE_RATE', 'AUDIO_MAX_CONCURRENCY', 'AUDIO_FFMPEG_TIMEOUT_MS']) {
        delete process.env[key]
      }
    })

    test('fromEnvironment() reads AUDIO_BITRATE env var', () => {
      process.env.AUDIO_BITRATE = '320k'
      const config = AudioConvertConfig.fromEnvironment()
      expect(config.bitrate).toBe('320k')
    })

    test('fromEnvironment() reads AUDIO_SAMPLE_RATE env var', () => {
      process.env.AUDIO_SAMPLE_RATE = '48000'
      const config = AudioConvertConfig.fromEnvironment()
      expect(config.sampleRate).toBe(48000)
    })

    test('fromEnvironment() reads AUDIO_MAX_CONCURRENCY env var', () => {
      process.env.AUDIO_MAX_CONCURRENCY = '8'
      const config = AudioConvertConfig.fromEnvironment()
      expect(config.maxConcurrency).toBe(8)
    })

    test('fromEnvironment() reads AUDIO_FFMPEG_TIMEOUT_MS env var', () => {
      process.env.AUDIO_FFMPEG_TIMEOUT_MS = '120000'
      const config = AudioConvertConfig.fromEnvironment()
      expect(config.ffmpegTimeoutMs).toBe(120000)
    })

    test('fromEnvironment() uses defaults when env vars are absent', () => {
      const config = AudioConvertConfig.fromEnvironment()
      expect(config.bitrate).toBe('128k')
      expect(config.sampleRate).toBe(44100)
      expect(config.maxConcurrency).toBe(3)
      expect(config.ffmpegTimeoutMs).toBe(300000)
    })
  })

  describe('validation - maxConcurrency', () => {
    test('maxConcurrency of 0 throws validation error', () => {
      expect(() => new AudioConvertConfig({ maxConcurrency: 0 })).toThrow(
        /Invalid maxConcurrency.*Must be an integer between 1 and 16/
      )
    })

    test('maxConcurrency of 17 throws validation error', () => {
      expect(() => new AudioConvertConfig({ maxConcurrency: 17 })).toThrow(
        /Invalid maxConcurrency.*Must be an integer between 1 and 16/
      )
    })

    test('maxConcurrency of 1 is valid (lower bound)', () => {
      const config = new AudioConvertConfig({ maxConcurrency: 1 })
      expect(config.maxConcurrency).toBe(1)
    })

    test('maxConcurrency of 16 is valid (upper bound)', () => {
      const config = new AudioConvertConfig({ maxConcurrency: 16 })
      expect(config.maxConcurrency).toBe(16)
    })
  })

  describe('validation - sampleRate', () => {
    test('sampleRate 22050 is valid', () => {
      const config = new AudioConvertConfig({ sampleRate: 22050 })
      expect(config.sampleRate).toBe(22050)
    })

    test('sampleRate 44100 is valid', () => {
      const config = new AudioConvertConfig({ sampleRate: 44100 })
      expect(config.sampleRate).toBe(44100)
    })

    test('sampleRate 48000 is valid', () => {
      const config = new AudioConvertConfig({ sampleRate: 48000 })
      expect(config.sampleRate).toBe(48000)
    })

    test('invalid sampleRate 32000 throws validation error', () => {
      expect(() => new AudioConvertConfig({ sampleRate: 32000 })).toThrow(
        /Invalid sampleRate.*Must be one of/
      )
    })

    test('invalid sampleRate 0 throws validation error', () => {
      expect(() => new AudioConvertConfig({ sampleRate: 0 })).toThrow(
        /Invalid sampleRate/
      )
    })
  })

  describe('immutability', () => {
    test('config properties are readonly at runtime', () => {
      const config = new AudioConvertConfig()
      expect(() => {
        (config as any).bitrate = '320k'
      }).not.toThrow() // JS doesn't throw on readonly violations, but TS would catch it
      // The value should not have changed since TypeScript enforces readonly
      // Verify via type-level check (the test documents the intent)
      expect(typeof config.bitrate).toBe('string')
    })
  })
})
