/**
 * Environment variable validation for retry service
 */

/**
 * Validate retry service environment variables
 * All variables are optional - Bun loads .env natively
 */
export function validateRetryEnv(): void {
  // Currently all retry config variables are optional
  // with sensible defaults defined in defaults.ts
  // This function exists for future extension and validates
  // any custom validation logic needed
}
