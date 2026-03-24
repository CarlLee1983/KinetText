/**
 * Retry configuration management
 * Handles configuration loading, validation, and defaults
 */

import { DEFAULT_RETRY_CONFIG } from './defaults'
import type { RetryConfigOptions } from '../core/types/retry'

/**
 * Configuration for retry mechanism
 * All properties are readonly to enforce immutability
 */
export class RetryConfig {
  readonly maxRetries: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly backoffFactor: number
  readonly jitterFactor: number
  readonly timeoutMs: number
  readonly operationTimeoutMs: number

  /**
   * Create a new RetryConfig instance
   * @param overrides Partial configuration overrides
   */
  constructor(overrides: RetryConfigOptions = {}) {
    this.maxRetries = this.validateRetries(
      overrides.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries
    )
    this.initialDelayMs = Math.max(
      0,
      overrides.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs
    )
    this.maxDelayMs = Math.max(
      0,
      overrides.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs
    )
    this.backoffFactor = Math.max(
      1,
      overrides.backoffFactor ?? DEFAULT_RETRY_CONFIG.backoffFactor
    )
    this.jitterFactor = Math.max(
      0,
      Math.min(
        1,
        overrides.jitterFactor ?? DEFAULT_RETRY_CONFIG.jitterFactor
      )
    )
    this.timeoutMs = Math.max(
      0,
      overrides.timeoutMs ?? DEFAULT_RETRY_CONFIG.timeoutMs
    )
    this.operationTimeoutMs = Math.max(
      0,
      overrides.operationTimeoutMs ?? DEFAULT_RETRY_CONFIG.operationTimeoutMs
    )
  }

  /**
   * Validate maxRetries value
   */
  private validateRetries(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 100) {
      throw new Error(
        `Invalid maxRetries: ${count}. Must be integer between 0 and 100.`
      )
    }
    return count
  }

  /**
   * Load configuration from environment variables
   * Environment variable names follow pattern: RETRY_*
   */
  static fromEnvironment(): RetryConfig {
    return new RetryConfig({
      maxRetries: parseInt(process.env.RETRY_MAX_RETRIES ?? '3', 10),
      initialDelayMs: parseInt(
        process.env.RETRY_INITIAL_DELAY_MS ?? '100',
        10
      ),
      maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS ?? '30000', 10),
      backoffFactor: parseFloat(process.env.RETRY_BACKOFF_FACTOR ?? '2'),
      jitterFactor: parseFloat(process.env.RETRY_JITTER_FACTOR ?? '0.1'),
      timeoutMs: parseInt(process.env.RETRY_TIMEOUT_MS ?? '10000', 10),
      operationTimeoutMs: parseInt(
        process.env.RETRY_OPERATION_TIMEOUT_MS ?? '60000',
        10
      )
    })
  }
}
