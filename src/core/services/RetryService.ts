/**
 * Core retry service
 * Orchestrates retry logic with exponential backoff
 */

import pino from 'pino'
import { ErrorClassifier } from './ErrorClassifier'
import { BackoffCalculator } from './BackoffCalculator'
import { RetryConfig } from '../../config/RetryConfig'
import {
  AsyncOperation,
  RetryResult,
  RetryAttempt,
  RetryCallback
} from '../types/retry'
import {
  ErrorCategory,
  RetryExhaustedError,
  PermanentError,
  OperationTimeoutError
} from '../types/errors'
import {
  retryLogger,
  logRetryAttemptStart,
  logRetryAttemptSuccess,
  logRetryAttemptFailed,
  logRetryWillRetry,
  logRetryExhausted,
  logPermanentError
} from '../utils/logger'

/**
 * Main retry service
 * Executes operations with automatic retry on transient failures
 */
export class RetryService {
  private readonly config: RetryConfig
  private readonly errorClassifier: ErrorClassifier
  private readonly backoffCalculator: BackoffCalculator
  private readonly logger: pino.Logger

  constructor(
    config: RetryConfig = new RetryConfig(),
    errorClassifier?: ErrorClassifier,
    logger?: pino.Logger
  ) {
    this.config = config
    this.errorClassifier = errorClassifier ?? new ErrorClassifier()
    this.backoffCalculator = new BackoffCalculator(
      config.initialDelayMs,
      config.maxDelayMs,
      config.backoffFactor,
      config.jitterFactor
    )
    this.logger = logger || retryLogger
  }

  /**
   * Execute operation with retry logic
   */
  async execute<T>(
    operation: AsyncOperation<T>,
    operationId?: string,
    onAttempt?: RetryCallback
  ): Promise<RetryResult<T>> {
    const startTimeMs = Date.now()
    let lastError: Error | null = null
    let attemptNumber = 0

    while (attemptNumber < this.config.maxRetries + 1) {
      attemptNumber++
      const elapsedMs = Date.now() - startTimeMs

      // Check if overall timeout exceeded
      if (
        this.config.operationTimeoutMs &&
        elapsedMs > this.config.operationTimeoutMs
      ) {
        const timeoutError = new OperationTimeoutError(
          this.config.operationTimeoutMs,
          elapsedMs
        )
        return {
          success: false,
          error: timeoutError,
          totalAttempts: attemptNumber,
          totalTimeMs: elapsedMs
        }
      }

      logRetryAttemptStart(
        this.logger,
        attemptNumber,
        this.config.maxRetries + 1,
        operationId
      )

      try {
        // Execute the operation with timeout
        const result = await this.executeWithTimeout(
          operation,
          this.config.timeoutMs
        )

        logRetryAttemptSuccess(
          this.logger,
          attemptNumber,
          Date.now() - startTimeMs,
          operationId
        )

        return {
          success: true,
          data: result,
          totalAttempts: attemptNumber,
          totalTimeMs: Date.now() - startTimeMs
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        logRetryAttemptFailed(
          this.logger,
          attemptNumber,
          lastError,
          operationId
        )

        // Classify the error
        const classification = this.errorClassifier.classify(lastError as Error)

        // If permanent error, fail immediately
        if (classification.category === ErrorCategory.PERMANENT) {
          logPermanentError(
            this.logger,
            classification.category,
            lastError,
            operationId
          )

          return {
            success: false,
            error: new PermanentError(lastError, classification),
            totalAttempts: attemptNumber,
            totalTimeMs: Date.now() - startTimeMs
          }
        }

        // If retries exhausted
        if (attemptNumber >= this.config.maxRetries + 1) {
          logRetryExhausted(
            this.logger,
            attemptNumber,
            Date.now() - startTimeMs,
            lastError,
            operationId
          )

          return {
            success: false,
            error: new RetryExhaustedError(
              attemptNumber,
              Date.now() - startTimeMs,
              lastError
            ),
            totalAttempts: attemptNumber,
            totalTimeMs: Date.now() - startTimeMs
          }
        }

        // Calculate backoff and retry
        const nextDelayMs = this.backoffCalculator.calculate(attemptNumber)
        const retriesLeft = this.config.maxRetries + 1 - attemptNumber

        logRetryWillRetry(
          this.logger,
          attemptNumber,
          nextDelayMs,
          retriesLeft,
          operationId
        )

        // Call attempt callback if provided
        if (onAttempt) {
          const attempt: RetryAttempt = {
            attemptNumber,
            retriesLeft,
            elapsedMs: Date.now() - startTimeMs,
            error: lastError,
            nextDelayMs
          }
          await onAttempt(attempt)
        }

        // Wait before retrying
        await this.delay(nextDelayMs)
      }
    }

    // Should not reach here, but just in case
    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      totalAttempts: attemptNumber,
      totalTimeMs: Date.now() - startTimeMs
    }
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: AsyncOperation<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Operation timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      )
    ])
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
