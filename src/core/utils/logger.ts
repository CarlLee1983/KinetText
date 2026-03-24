/**
 * Structured logging setup using Pino
 */

import pino from 'pino'

/**
 * Create a logger instance with standardized configuration
 */
export const createLogger = (name: string, options?: pino.LoggerOptions) => {
  const logLevel = process.env.LOG_LEVEL || 'info'

  return pino({
    level: logLevel,
    name,
    ...(options || {})
  })
}

/**
 * Logger instance for retry service
 */
export const retryLogger = createLogger('retry-service')

/**
 * Log retry attempt start
 */
export function logRetryAttemptStart(
  logger: pino.Logger,
  attemptNumber: number,
  maxAttempts: number,
  operationId?: string
): void {
  logger.info(
    {
      event: 'retry_attempt_start',
      attemptNumber,
      maxAttempts,
      operationId
    },
    `Starting retry attempt ${attemptNumber}/${maxAttempts}`
  )
}

/**
 * Log retry attempt success
 */
export function logRetryAttemptSuccess(
  logger: pino.Logger,
  attemptNumber: number,
  elapsedMs: number,
  operationId?: string
): void {
  logger.info(
    {
      event: 'retry_attempt_success',
      attemptNumber,
      elapsedMs,
      operationId
    },
    `Attempt ${attemptNumber} succeeded (${elapsedMs}ms)`
  )
}

/**
 * Log retry attempt failure
 */
export function logRetryAttemptFailed(
  logger: pino.Logger,
  attemptNumber: number,
  error: Error,
  operationId?: string
): void {
  logger.warn(
    {
      event: 'retry_attempt_failed',
      attemptNumber,
      errorMessage: error.message,
      errorName: error.name,
      operationId
    },
    `Attempt ${attemptNumber} failed: ${error.message}`
  )
}

/**
 * Log retry will proceed (with delay)
 */
export function logRetryWillRetry(
  logger: pino.Logger,
  attemptNumber: number,
  nextDelayMs: number,
  retriesLeft: number,
  operationId?: string
): void {
  logger.info(
    {
      event: 'retry_will_retry',
      attemptNumber,
      nextDelayMs,
      retriesLeft,
      operationId
    },
    `Will retry in ${nextDelayMs}ms (${retriesLeft} attempts left)`
  )
}

/**
 * Log retry exhausted
 */
export function logRetryExhausted(
  logger: pino.Logger,
  totalAttempts: number,
  totalTimeMs: number,
  lastError: Error,
  operationId?: string
): void {
  logger.error(
    {
      event: 'retry_exhausted',
      totalAttempts,
      totalTimeMs,
      lastErrorMessage: lastError.message,
      operationId
    },
    `Retries exhausted after ${totalAttempts} attempts (${totalTimeMs}ms)`
  )
}

/**
 * Log permanent error
 */
export function logPermanentError(
  logger: pino.Logger,
  errorCategory: string,
  error: Error,
  operationId?: string
): void {
  logger.error(
    {
      event: 'retry_permanent_error',
      errorCategory,
      errorMessage: error.message,
      operationId
    },
    `Permanent error (${errorCategory}): ${error.message}`
  )
}
