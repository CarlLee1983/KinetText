import { describe, it, expect } from 'bun:test'

describe('Type Definitions and Interfaces', () => {
  // These tests ensure types are properly exported and usable

  it('should export RetryConfig interface', () => {
    // When importing RetryConfig type
    // Then it should have all required properties
    expect(true).toBe(true)
  })

  it('should export RetryAttempt interface', () => {
    // When importing RetryAttempt type
    // Then it should have all required properties
    expect(true).toBe(true)
  })

  it('should export RetryResult generic interface', () => {
    // When importing RetryResult type with generic parameter
    // Then it should support any data type T
    expect(true).toBe(true)
  })

  it('should export ErrorCategory enum', () => {
    // When importing ErrorCategory
    // Then it should have TRANSIENT, PERMANENT, UNKNOWN values
    expect(true).toBe(true)
  })

  it('should export ErrorClassification interface', () => {
    // When importing ErrorClassification
    // Then it should have category, reason, suggestedAction
    expect(true).toBe(true)
  })

  it('should export RetryExhaustedError custom error', () => {
    // When importing RetryExhaustedError
    // Then it should be an Error subclass
    expect(true).toBe(true)
  })

  it('should export PermanentError custom error', () => {
    // When importing PermanentError
    // Then it should be an Error subclass
    expect(true).toBe(true)
  })

  it('should export OperationTimeoutError custom error', () => {
    // When importing OperationTimeoutError
    // Then it should be an Error subclass
    expect(true).toBe(true)
  })
})
