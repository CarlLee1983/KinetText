/**
 * Backoff calculation service
 * Implements exponential backoff with jitter for retry delays
 */

/**
 * Calculates exponential backoff delays with jitter
 * Formula: delay = initialDelay × (factor ^ attempt) + jitter
 */
export class BackoffCalculator {
  constructor(
    private readonly initialDelayMs: number,
    private readonly maxDelayMs: number,
    private readonly backoffFactor: number,
    private readonly jitterFactor: number
  ) {}

  /**
   * Calculate the delay for a given attempt number
   * @param attemptNumber 1-indexed attempt number
   * @returns Delay in milliseconds
   */
  calculate(attemptNumber: number): number {
    // Calculate base delay: initialDelay × (factor ^ (attemptNumber - 1))
    const baseDelay = this.initialDelayMs *
      Math.pow(this.backoffFactor, Math.max(0, attemptNumber - 1))

    // Cap at maximum delay
    const cappedDelay = Math.min(baseDelay, this.maxDelayMs)

    // Add jitter: ±(delay × jitterFactor)
    const jitterRange = cappedDelay * this.jitterFactor
    const jitter = (Math.random() * 2 - 1) * jitterRange

    // Ensure delay is never negative
    return Math.max(0, Math.round(cappedDelay + jitter))
  }

  /**
   * Format delay duration for logging
   */
  formatDelay(delayMs: number): string {
    if (delayMs < 1000) {
      return `${delayMs}ms`
    }
    return `${(delayMs / 1000).toFixed(2)}s`
  }
}
