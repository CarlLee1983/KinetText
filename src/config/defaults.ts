/**
 * Default retry configuration values
 */

/**
 * Default configuration for retry service
 * These are production-safe defaults
 */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,           // 3 retries = 4 total attempts
  initialDelayMs: 100,     // Start with 100ms
  maxDelayMs: 30000,       // Cap at 30 seconds
  backoffFactor: 2,        // Double each time (exponential)
  jitterFactor: 0.1,       // ±10% randomness
  timeoutMs: 10000,        // 10 second timeout per request
  operationTimeoutMs: 60000 // 60 second timeout for full operation
} as const
