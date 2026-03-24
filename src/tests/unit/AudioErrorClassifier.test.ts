/**
 * Unit tests for AudioErrorClassifier
 */

import { describe, test, expect } from 'bun:test'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import { ErrorCategory } from '../../core/types/errors'

describe('AudioErrorClassifier', () => {
  const classifier = new AudioErrorClassifier()

  describe('FFmpeg permanent errors', () => {
    test('Error containing "No such file" is classified as PERMANENT', () => {
      const result = classifier.classify(new Error('No such file or directory'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    test('Error containing "Invalid data" is classified as PERMANENT', () => {
      const result = classifier.classify(new Error('Invalid data found when processing input'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    test('Error containing "Unsupported codec" is classified as PERMANENT', () => {
      const result = classifier.classify(new Error('Unsupported codec: xvid'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    test('Error containing "Permission denied" is classified as PERMANENT', () => {
      const result = classifier.classify(new Error('Permission denied: /output/file.mp3'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    test('Error containing "Unrecognized option" is classified as PERMANENT', () => {
      const result = classifier.classify(new Error('Unrecognized option: -badopt'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })
  })

  describe('FFmpeg transient errors', () => {
    test('Error containing "Cannot allocate memory" is classified as TRANSIENT', () => {
      const result = classifier.classify(new Error('Cannot allocate memory'))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    test('Error containing "broken pipe" is classified as TRANSIENT', () => {
      const result = classifier.classify(new Error('broken pipe encountered'))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    test('Error containing "Resource temporarily unavailable" is classified as TRANSIENT', () => {
      const result = classifier.classify(new Error('Resource temporarily unavailable'))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    test('Error containing "timeout" is classified as TRANSIENT', () => {
      const result = classifier.classify(new Error('Connection timeout'))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })
  })

  describe('Unknown FFmpeg errors', () => {
    test('Generic FFmpeg failure with random stderr classified as UNKNOWN with BACKOFF', () => {
      const result = classifier.classify(new Error('FFmpeg failed (exit 1): random stderr output here'))
      expect(result.category).toBe(ErrorCategory.UNKNOWN)
      expect(result.suggestedAction).toBe('BACKOFF')
    })

    test('Empty error message classified as UNKNOWN', () => {
      const result = classifier.classify(new Error(''))
      expect(result.category).toBe(ErrorCategory.UNKNOWN)
    })
  })

  describe('HTTP error inheritance from ErrorClassifier', () => {
    test('HTTP 404 Response is classified as PERMANENT (inherited)', () => {
      const response = new Response(null, { status: 404 })
      const result = classifier.classify(response)
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    test('HTTP 503 Response is classified as TRANSIENT (inherited)', () => {
      const response = new Response(null, { status: 503 })
      const result = classifier.classify(response)
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    test('HTTP 429 Response is classified as TRANSIENT (inherited)', () => {
      const response = new Response(null, { status: 429 })
      const result = classifier.classify(response)
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })
  })

  describe('case insensitivity', () => {
    test('error messages are matched case-insensitively', () => {
      const result = classifier.classify(new Error('NO SUCH FILE OR DIRECTORY'))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
    })

    test('lowercase "broken pipe" matches correctly', () => {
      const result = classifier.classify(new Error('broken pipe'))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
    })
  })
})
