/**
 * Unit tests for DurationService
 * Uses dependency injection for metadata reader to avoid needing real files
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { DurationService } from '../../core/services/DurationService'
import type { DurationMetadataReader } from '../../core/services/DurationService'
import type { DurationGoConfig } from '../../config/DurationGoConfig'

/** Create a mock metadata reader that returns a controlled duration */
const makeMockReader = (durationsByPath: Record<string, number>): DurationMetadataReader => {
  return async (filePath: string) => {
    const duration = durationsByPath[filePath]
    if (duration === undefined) {
      throw new Error(`No mock duration for ${filePath}`)
    }
    return duration
  }
}

describe('DurationService', () => {
  describe('getDuration()', () => {
    test('returns duration in seconds from metadata reader', async () => {
      const reader = makeMockReader({ '/test/audio.mp3': 120.5 })
      const service = new DurationService({ metadataReader: reader })
      const duration = await service.getDuration('/test/audio.mp3')
      expect(duration).toBe(120.5)
    })

    test('returns 0 when metadata reader returns 0 duration', async () => {
      const reader = makeMockReader({ '/test/empty.mp3': 0 })
      const service = new DurationService({ metadataReader: reader })
      const duration = await service.getDuration('/test/empty.mp3')
      expect(duration).toBe(0)
    })
  })

  describe('calculateTotalDuration()', () => {
    test('sums all file durations correctly', async () => {
      const reader = makeMockReader({
        '/test/a.mp3': 3600,
        '/test/b.mp3': 7200,
        '/test/c.mp3': 1800,
      })
      const service = new DurationService({ metadataReader: reader })
      const total = await service.calculateTotalDuration(['/test/a.mp3', '/test/b.mp3', '/test/c.mp3'])
      expect(total).toBe(12600) // 3.5 hours
    })

    test('returns 0 for empty array', async () => {
      const reader = makeMockReader({})
      const service = new DurationService({ metadataReader: reader })
      const total = await service.calculateTotalDuration([])
      expect(total).toBe(0)
    })

    test('returns duration of single file', async () => {
      const reader = makeMockReader({ '/test/single.mp3': 5400 })
      const service = new DurationService({ metadataReader: reader })
      const total = await service.calculateTotalDuration(['/test/single.mp3'])
      expect(total).toBe(5400)
    })
  })

  describe('validateDuration()', () => {
    const service = new DurationService()

    test('returns true when actual equals target (exact match)', () => {
      expect(service.validateDuration(39600, 39600, 10)).toBe(true)
    })

    test('returns true at lower edge of tolerance (39600 * 0.9 = 35640)', () => {
      expect(service.validateDuration(35640, 39600, 10)).toBe(true)
    })

    test('returns true at upper edge of tolerance (39600 * 1.1 = 43560)', () => {
      expect(service.validateDuration(43560, 39600, 10)).toBe(true)
    })

    test('returns false when below tolerance (30000 vs 39600 at 10%)', () => {
      expect(service.validateDuration(30000, 39600, 10)).toBe(false)
    })

    test('returns false when above tolerance (50000 vs 39600 at 10%)', () => {
      expect(service.validateDuration(50000, 39600, 10)).toBe(false)
    })

    test('returns true with default tolerancePercent (10)', () => {
      // 39600 * 1.09 = 43164, which is within 10%
      expect(service.validateDuration(43164, 39600)).toBe(true)
    })

    test('handles 0% tolerance (exact match required)', () => {
      expect(service.validateDuration(39600, 39600, 0)).toBe(true)
      expect(service.validateDuration(39601, 39600, 0)).toBe(false)
    })

    test('handles large tolerance (50%)', () => {
      // 39600 * 0.5 = 19800 and 39600 * 1.5 = 59400
      expect(service.validateDuration(19800, 39600, 50)).toBe(true)
      expect(service.validateDuration(59400, 39600, 50)).toBe(true)
      expect(service.validateDuration(19799, 39600, 50)).toBe(false)
    })
  })

  describe('generateReport()', () => {
    test('returns complete DurationReport with per-file durations and withinTolerance', async () => {
      const reader = makeMockReader({
        '/test/a.mp3': 14400,  // 4 hours
        '/test/b.mp3': 14400,  // 4 hours
        '/test/c.mp3': 14400,  // 4 hours
      })
      const service = new DurationService({ metadataReader: reader })
      const report = await service.generateReport(
        ['/test/a.mp3', '/test/b.mp3', '/test/c.mp3'],
        39600,  // 11 hours target
        10      // 10% tolerance
      )

      expect(report.files).toHaveLength(3)
      expect(report.totalDuration).toBe(43200)   // 12 hours
      expect(report.targetDuration).toBe(39600)  // 11 hours
      expect(report.tolerancePercent).toBe(10)
      // 43200 (12h) vs 39600 (11h): upper bound = 39600 * 1.1 = 43560
      // 43200 < 43560, so it IS within tolerance
      expect(report.withinTolerance).toBe(true)
    })

    test('report files array has correct path and duration for each file', async () => {
      const reader = makeMockReader({
        '/test/a.mp3': 3600,
        '/test/b.mp3': 7200,
      })
      const service = new DurationService({ metadataReader: reader })
      const report = await service.generateReport(['/test/a.mp3', '/test/b.mp3'], 39600)

      expect(report.files[0]).toEqual({ path: '/test/a.mp3', duration: 3600 })
      expect(report.files[1]).toEqual({ path: '/test/b.mp3', duration: 7200 })
    })

    test('report withinTolerance is true when total is within tolerance', async () => {
      const reader = makeMockReader({
        '/test/a.mp3': 19800,   // 5.5 hours x 2 = 11 hours exactly
        '/test/b.mp3': 19800,
      })
      const service = new DurationService({ metadataReader: reader })
      const report = await service.generateReport(['/test/a.mp3', '/test/b.mp3'], 39600, 10)
      expect(report.withinTolerance).toBe(true)
    })
  })

  describe('formatDuration()', () => {
    const service = new DurationService()

    test('formats 11 hours as "11h 00m 00s"', () => {
      expect(service.formatDuration(39600)).toBe('11h 00m 00s')
    })

    test('formats 0 seconds as "0h 00m 00s"', () => {
      expect(service.formatDuration(0)).toBe('0h 00m 00s')
    })

    test('formats mixed hours/minutes/seconds correctly', () => {
      // 1h 23m 45s = 3600 + 23*60 + 45 = 3600 + 1380 + 45 = 5025
      expect(service.formatDuration(5025)).toBe('1h 23m 45s')
    })

    test('formats exactly 1 minute as "0h 01m 00s"', () => {
      expect(service.formatDuration(60)).toBe('0h 01m 00s')
    })

    test('formats 59 seconds as "0h 00m 59s"', () => {
      expect(service.formatDuration(59)).toBe('0h 00m 59s')
    })
  })

  describe('Go backend support (enableGoBackend)', () => {
    test('DurationService with Go backend config enabled (mock fallback to Bun)', async () => {
      const reader = makeMockReader({
        '/test/a.mp3': 3600,
        '/test/b.mp3': 7200,
      })

      // Note: Unit test uses mock reader; Go binary not available in unit test context
      // In practice, Go backend would be tested in integration/E2E tests
      const goConfig: DurationGoConfig = {
        enabled: true,
        goBinaryPath: '../../../kinetitext-go/bin/kinetitext-duration',
        timeout: 30000,
        concurrency: 4,
        perFileTimeout: 5000,
      }

      const service = new DurationService({
        metadataReader: reader,
        enableGoBackend: true,
        goBackendConfig: goConfig,
      })

      // Since Go binary is not available in unit test context, fallback to Bun
      const total = await service.calculateTotalDuration(['/test/a.mp3', '/test/b.mp3'])
      expect(total).toBe(10800)
    })
  })
})
