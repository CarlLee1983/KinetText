/**
 * Error classification service
 * Categorizes errors as TRANSIENT, PERMANENT, or UNKNOWN
 */

import { ErrorCategory, ErrorClassification } from '../types/errors'

/**
 * Classifies errors to determine if they should be retried
 */
export class ErrorClassifier {
  private readonly transientStatusCodes = [408, 429, 500, 502, 503, 504]
  private readonly permanentStatusCodes = [400, 401, 403, 404, 422]
  private readonly transientNetworkErrors = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ERR_TIMEOUT',
    'ERR_NETWORK',
    'EAGAIN',
    'EHOSTUNREACH'
  ]
  private readonly permanentNetworkErrors = [
    'ENOTFOUND',
    'ENOENT',
    'ERR_CERT',
    'EBADF'
  ]

  /**
   * Classify an error to determine if it should be retried
   */
  classify(error: Error | Response): ErrorClassification {
    // Check if this is an HTTP Response
    if (error instanceof Response) {
      return this.classifyHttpError(error.status)
    }

    // Check network/application errors
    return this.classifyNetworkError(error)
  }

  /**
   * Classify HTTP response status code
   */
  private classifyHttpError(status: number): ErrorClassification {
    if (this.transientStatusCodes.includes(status)) {
      return {
        category: ErrorCategory.TRANSIENT,
        reason: `HTTP ${status} is a transient error (retryable)`,
        suggestedAction: 'RETRY'
      }
    }

    if (this.permanentStatusCodes.includes(status)) {
      return {
        category: ErrorCategory.PERMANENT,
        reason: `HTTP ${status} is a permanent error (not retryable)`,
        suggestedAction: 'FAIL'
      }
    }

    return {
      category: ErrorCategory.UNKNOWN,
      reason: `HTTP ${status} classification is unknown`,
      suggestedAction: 'BACKOFF'
    }
  }

  /**
   * Classify network/application errors
   */
  private classifyNetworkError(error: Error): ErrorClassification {
    const message = error.message || ''
    const code = (error as any).code || ''

    const errorStr = `${message} ${code}`.toUpperCase()

    // Check for transient network errors
    for (const pattern of this.transientNetworkErrors) {
      if (errorStr.includes(pattern)) {
        return {
          category: ErrorCategory.TRANSIENT,
          reason: `Network error ${pattern} is transient`,
          suggestedAction: 'RETRY'
        }
      }
    }

    // Check for permanent network errors
    for (const pattern of this.permanentNetworkErrors) {
      if (errorStr.includes(pattern)) {
        return {
          category: ErrorCategory.PERMANENT,
          reason: `Network error ${pattern} is permanent`,
          suggestedAction: 'FAIL'
        }
      }
    }

    return {
      category: ErrorCategory.UNKNOWN,
      reason: `Unknown network error: ${message}`,
      suggestedAction: 'BACKOFF'
    }
  }
}
