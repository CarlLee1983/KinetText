/**
 * Retry mechanism type definitions
 * Provides TypeScript interfaces and types for the retry service
 */

/**
 * Configuration options for the retry mechanism
 */
export interface RetryConfigOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in milliseconds before first retry (default: 100) */
  initialDelayMs?: number
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number
  /** Jitter factor for randomization (0-1, default: 0.1) */
  jitterFactor?: number
  /** Timeout for individual operations in milliseconds (default: 10000) */
  timeoutMs?: number
  /** Overall operation timeout in milliseconds (optional, default: 60000) */
  operationTimeoutMs?: number
}

/**
 * Information about a single retry attempt
 */
export interface RetryAttempt {
  /** Current attempt number (1-indexed) */
  attemptNumber: number
  /** Number of retries still available */
  retriesLeft: number
  /** Total elapsed time since operation start in milliseconds */
  elapsedMs: number
  /** Error that caused this attempt to fail */
  error: Error
  /** Calculated delay before next retry in milliseconds */
  nextDelayMs: number
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean
  /** The result data (if successful) */
  data?: T
  /** The error (if failed) */
  error?: Error
  /** Total number of attempts made */
  totalAttempts: number
  /** Total elapsed time in milliseconds */
  totalTimeMs: number
}

/**
 * Callback for monitoring retry attempts
 */
export type RetryCallback = (attempt: RetryAttempt) => void | Promise<void>

/**
 * Async operation function signature
 */
export type AsyncOperation<T> = () => Promise<T>
