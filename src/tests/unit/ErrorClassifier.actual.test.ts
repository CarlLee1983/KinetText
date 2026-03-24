import { describe, it, expect } from 'bun:test'
import { ErrorClassifier } from '../../core/services/ErrorClassifier'
import { ErrorCategory } from '../../core/types/errors'

describe('ErrorClassifier - Actual Implementation', () => {
  const classifier = new ErrorClassifier()

  describe('HTTP Error Classification', () => {
    it('should classify 408 as TRANSIENT', () => {
      const result = classifier.classify(new Response('', { status: 408 }))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    it('should classify 429 as TRANSIENT', () => {
      const result = classifier.classify(new Response('', { status: 429 }))
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    it('should classify 5xx errors as TRANSIENT', () => {
      for (const status of [500, 502, 503, 504]) {
        const result = classifier.classify(new Response('', { status }))
        expect(result.category).toBe(ErrorCategory.TRANSIENT)
        expect(result.suggestedAction).toBe('RETRY')
      }
    })

    it('should classify 400 as PERMANENT', () => {
      const result = classifier.classify(new Response('', { status: 400 }))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    it('should classify 404 as PERMANENT', () => {
      const result = classifier.classify(new Response('', { status: 404 }))
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    it('should classify unknown status as UNKNOWN', () => {
      const result = classifier.classify(new Response('', { status: 418 })) // I'm a teapot
      expect(result.category).toBe(ErrorCategory.UNKNOWN)
      expect(result.suggestedAction).toBe('BACKOFF')
    })
  })

  describe('Network Error Classification', () => {
    it('should classify ECONNREFUSED as TRANSIENT', () => {
      const error = new Error('Connection refused')
      ;(error as any).code = 'ECONNREFUSED'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
      expect(result.suggestedAction).toBe('RETRY')
    })

    it('should classify ECONNRESET as TRANSIENT', () => {
      const error = new Error('Connection reset')
      ;(error as any).code = 'ECONNRESET'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
    })

    it('should classify ETIMEDOUT as TRANSIENT', () => {
      const error = new Error('Operation timeout')
      ;(error as any).code = 'ETIMEDOUT'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.TRANSIENT)
    })

    it('should classify ENOTFOUND as PERMANENT', () => {
      const error = new Error('getaddrinfo ENOTFOUND example.com')
      ;(error as any).code = 'ENOTFOUND'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.PERMANENT)
      expect(result.suggestedAction).toBe('FAIL')
    })

    it('should classify ERR_CERT_* as PERMANENT', () => {
      const error = new Error('Certificate error')
      ;(error as any).code = 'ERR_CERT_AUTHORITY_INVALID'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.PERMANENT)
    })

    it('should classify unknown error as UNKNOWN', () => {
      const error = new Error('Some weird error')
      ;(error as any).code = 'UNKNOWN_CODE'
      const result = classifier.classify(error)
      expect(result.category).toBe(ErrorCategory.UNKNOWN)
    })
  })

  describe('Classification Metadata', () => {
    it('should include reason in result', () => {
      const result = classifier.classify(new Response('', { status: 500 }))
      expect(result.reason).toBeTruthy()
      expect(result.reason.length).toBeGreaterThan(0)
    })

    it('should have valid suggestedAction', () => {
      const result = classifier.classify(new Response('', { status: 500 }))
      expect(['RETRY', 'FAIL', 'BACKOFF']).toContain(result.suggestedAction)
    })
  })
})
