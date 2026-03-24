import { describe, it, expect } from 'bun:test'
import { BackoffCalculator } from '../../core/services/BackoffCalculator'

describe('BackoffCalculator - Actual Implementation', () => {
  describe('Exponential Backoff Calculation', () => {
    it('should calculate first attempt as initialDelay', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      const delay = calc.calculate(1)
      expect(delay).toBe(100)
    })

    it('should double delay for second attempt', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      const delay = calc.calculate(2)
      expect(delay).toBe(200)
    })

    it('should quadruple delay for third attempt', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      const delay = calc.calculate(3)
      expect(delay).toBe(400)
    })

    it('should support custom backoff factor', () => {
      const calc = new BackoffCalculator(100, 30000, 3, 0)
      const delay = calc.calculate(2)
      expect(delay).toBe(300)
    })
  })

  describe('Maximum Delay Capping', () => {
    it('should not exceed maxDelayMs', () => {
      const calc = new BackoffCalculator(100, 5000, 2, 0)
      const delay = calc.calculate(10) // Would be huge without cap
      expect(delay).toBeLessThanOrEqual(5000)
    })

    it('should cap at maxDelayMs for attempt 6', () => {
      const calc = new BackoffCalculator(100, 3200, 2, 0)
      const delay = calc.calculate(6) // 100 * 2^5 = 3200
      expect(delay).toBeLessThanOrEqual(3200)
    })
  })

  describe('Jitter Application', () => {
    it('should apply jitter within range', () => {
      const calc = new BackoffCalculator(1000, 30000, 2, 0.1)
      // Run multiple times to ensure jitter is applied
      const delays = Array.from({ length: 10 }, (_, i) => calc.calculate(1))
      const minDelay = Math.min(...delays)
      const maxDelay = Math.max(...delays)
      // With jitter 0.1, should be between 900-1100
      expect(minDelay).toBeGreaterThanOrEqual(900)
      expect(maxDelay).toBeLessThanOrEqual(1100)
    })

    it('should have no jitter when jitterFactor is 0', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      const delay1 = calc.calculate(2)
      const delay2 = calc.calculate(2)
      expect(delay1).toBe(delay2)
      expect(delay1).toBe(200)
    })

    it('should ensure delay never goes negative', () => {
      const calc = new BackoffCalculator(10, 30000, 2, 1) // max jitter
      for (let i = 1; i <= 5; i++) {
        const delay = calc.calculate(i)
        expect(delay).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Formatting', () => {
    it('should format milliseconds correctly', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      expect(calc.formatDelay(500)).toBe('500ms')
    })

    it('should format seconds correctly', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      expect(calc.formatDelay(1500)).toBe('1.50s')
    })

    it('should format large delays as seconds', () => {
      const calc = new BackoffCalculator(100, 30000, 2, 0)
      expect(calc.formatDelay(30000)).toBe('30.00s')
    })
  })
})
