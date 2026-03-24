/**
 * Audio-specific error classification service
 * Extends ErrorClassifier to handle FFmpeg-specific error patterns
 */

import { ErrorClassifier } from './ErrorClassifier'
import { ErrorCategory, ErrorClassification } from '../types/errors'

/**
 * Classifies FFmpeg errors alongside standard HTTP/network errors.
 * FFmpeg permanent errors (corrupt input, bad codec) fail immediately.
 * FFmpeg transient errors (memory, pipe) are retried.
 */
export class AudioErrorClassifier extends ErrorClassifier {
  private readonly ffmpegTransientPatterns = [
    'CANNOT ALLOCATE',
    'BROKEN PIPE',
    'RESOURCE TEMPORARILY UNAVAILABLE',
    'CONNECTION RESET',
    'TIMEOUT',
  ]

  private readonly ffmpegPermanentPatterns = [
    'NO SUCH FILE',
    'INVALID DATA',
    'UNSUPPORTED CODEC',
    'PERMISSION DENIED',
    'INVALID ARGUMENT',
    'NO SUCH FILTER',
    'UNRECOGNIZED OPTION',
  ]

  /**
   * Classify an error for retry decision.
   * HTTP Response objects are delegated to parent classifier.
   * Error objects are checked for FFmpeg patterns first, then fall back to parent.
   */
  classify(error: Error | Response): ErrorClassification {
    // HTTP Response: delegate to parent
    if (error instanceof Response) {
      return super.classify(error)
    }

    // Try FFmpeg-specific classification first
    const ffmpegResult = this.classifyFfmpegError(error)
    if (ffmpegResult) {
      return ffmpegResult
    }

    // Fall back to parent network error classification
    return super.classify(error)
  }

  /**
   * Check if error matches known FFmpeg error patterns.
   * Returns null if no FFmpeg-specific pattern matched.
   */
  private classifyFfmpegError(error: Error): ErrorClassification | null {
    const message = (error.message || '').toUpperCase()

    for (const pattern of this.ffmpegPermanentPatterns) {
      if (message.includes(pattern)) {
        return {
          category: ErrorCategory.PERMANENT,
          reason: `FFmpeg permanent error: ${pattern.toLowerCase()}`,
          suggestedAction: 'FAIL',
        }
      }
    }

    for (const pattern of this.ffmpegTransientPatterns) {
      if (message.includes(pattern)) {
        return {
          category: ErrorCategory.TRANSIENT,
          reason: `FFmpeg transient error: ${pattern.toLowerCase()}`,
          suggestedAction: 'RETRY',
        }
      }
    }

    // No FFmpeg-specific pattern matched, fall through to parent
    return null
  }
}
