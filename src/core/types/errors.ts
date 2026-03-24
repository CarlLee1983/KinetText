/**
 * Error types and classifications for the retry mechanism
 */

/**
 * Categories for error classification
 */
export enum ErrorCategory {
  /** Transient error - should be retried */
  TRANSIENT = 'TRANSIENT',
  /** Permanent error - should not be retried */
  PERMANENT = 'PERMANENT',
  /** Unknown error - should be handled carefully */
  UNKNOWN = 'UNKNOWN'
}

/**
 * Result of error classification
 */
export interface ErrorClassification {
  /** The category of the error */
  category: ErrorCategory
  /** Human-readable reason for this classification */
  reason: string
  /** Suggested action: RETRY, FAIL, or BACKOFF */
  suggestedAction: 'RETRY' | 'FAIL' | 'BACKOFF'
}

/**
 * Custom error: Retry attempts exhausted
 */
export class RetryExhaustedError extends Error {
  public readonly totalAttempts: number
  public readonly totalTimeMs: number
  public readonly lastError: Error

  constructor(
    totalAttempts: number,
    totalTimeMs: number,
    lastError: Error
  ) {
    super(
      `Retry exhausted after ${totalAttempts} attempts (${totalTimeMs}ms). Last error: ${lastError.message}`
    )
    this.name = 'RetryExhaustedError'
    this.totalAttempts = totalAttempts
    this.totalTimeMs = totalTimeMs
    this.lastError = lastError
    Object.setPrototypeOf(this, RetryExhaustedError.prototype)
  }
}

/**
 * Custom error: Permanent error (should not retry)
 */
export class PermanentError extends Error {
  public readonly originalError: Error
  public readonly classification: ErrorClassification

  constructor(originalError: Error, classification: ErrorClassification) {
    super(
      `Permanent error (${classification.category}): ${originalError.message}`
    )
    this.name = 'PermanentError'
    this.originalError = originalError
    this.classification = classification
    Object.setPrototypeOf(this, PermanentError.prototype)
  }
}

/**
 * Custom error: Operation timeout
 */
export class OperationTimeoutError extends Error {
  public readonly timeoutMs: number
  public readonly elapsedMs: number

  constructor(timeoutMs: number, elapsedMs: number) {
    super(
      `Operation timeout: exceeded ${timeoutMs}ms limit (elapsed: ${elapsedMs}ms)`
    )
    this.name = 'OperationTimeoutError'
    this.timeoutMs = timeoutMs
    this.elapsedMs = elapsedMs
    Object.setPrototypeOf(this, OperationTimeoutError.prototype)
  }
}
