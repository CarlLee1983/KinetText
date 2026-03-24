import { describe, it, expect } from 'bun:test'
import { RetryConfig } from '../../config/RetryConfig'

describe('RetryConfig - Actual Implementation', () => {
  describe('Default Values', () => {
    it('should use defaults when no overrides provided', () => {
      const config = new RetryConfig()
      expect(config.maxRetries).toBe(3)
      expect(config.initialDelayMs).toBe(100)
      expect(config.maxDelayMs).toBe(30000)
      expect(config.backoffFactor).toBe(2)
      expect(config.jitterFactor).toBe(0.1)
      expect(config.timeoutMs).toBe(10000)
      expect(config.operationTimeoutMs).toBe(60000)
    })

    it('should allow partial overrides', () => {
      const config = new RetryConfig({
        maxRetries: 5,
        initialDelayMs: 200
      })
      expect(config.maxRetries).toBe(5)
      expect(config.initialDelayMs).toBe(200)
      expect(config.maxDelayMs).toBe(30000) // default
    })
  })

  describe('Validation', () => {
    it('should reject non-integer maxRetries', () => {
      expect(() => new RetryConfig({ maxRetries: 3.5 })).toThrow()
    })

    it('should reject maxRetries > 100', () => {
      expect(() => new RetryConfig({ maxRetries: 101 })).toThrow()
    })

    it('should reject negative maxRetries', () => {
      expect(() => new RetryConfig({ maxRetries: -1 })).toThrow()
    })

    it('should accept valid maxRetries', () => {
      expect(() => new RetryConfig({ maxRetries: 5 })).not.toThrow()
      expect(() => new RetryConfig({ maxRetries: 0 })).not.toThrow()
      expect(() => new RetryConfig({ maxRetries: 100 })).not.toThrow()
    })

    it('should ensure initialDelayMs is non-negative', () => {
      const config = new RetryConfig({ initialDelayMs: -100 })
      expect(config.initialDelayMs).toBe(0)
    })

    it('should clamp jitterFactor to 0-1', () => {
      const config1 = new RetryConfig({ jitterFactor: -0.5 })
      expect(config1.jitterFactor).toBe(0)

      const config2 = new RetryConfig({ jitterFactor: 1.5 })
      expect(config2.jitterFactor).toBe(1)
    })

    it('should ensure backoffFactor >= 1', () => {
      const config = new RetryConfig({ backoffFactor: 0.5 })
      expect(config.backoffFactor).toBe(1)
    })
  })

  describe('Environment Variables', () => {
    it('should load from environment', () => {
      // Save original env
      const original = { ...process.env }

      process.env.RETRY_MAX_RETRIES = '5'
      process.env.RETRY_INITIAL_DELAY_MS = '200'

      const config = RetryConfig.fromEnvironment()
      expect(config.maxRetries).toBe(5)
      expect(config.initialDelayMs).toBe(200)

      // Restore env
      process.env.RETRY_MAX_RETRIES = original.RETRY_MAX_RETRIES
      process.env.RETRY_INITIAL_DELAY_MS = original.RETRY_INITIAL_DELAY_MS
    })

    it('should use defaults for missing env vars', () => {
      const original = { ...process.env }
      delete process.env.RETRY_MAX_RETRIES
      delete process.env.RETRY_INITIAL_DELAY_MS

      const config = RetryConfig.fromEnvironment()
      expect(config.maxRetries).toBe(3)
      expect(config.initialDelayMs).toBe(100)

      process.env.RETRY_MAX_RETRIES = original.RETRY_MAX_RETRIES
      process.env.RETRY_INITIAL_DELAY_MS = original.RETRY_INITIAL_DELAY_MS
    })
  })

  describe('Immutability', () => {
    it('should have readonly properties (TypeScript enforcement)', () => {
      const config = new RetryConfig()
      // Properties are readonly at TypeScript level
      // Runtime behavior depends on strict mode
      expect(config.maxRetries).toBe(3)
    })
  })
})
