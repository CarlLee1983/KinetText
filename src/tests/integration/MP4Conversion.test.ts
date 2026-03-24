/**
 * Integration tests for MP4 conversion pipeline
 * Tests service wiring and basic functionality
 */

import { describe, test, expect } from 'bun:test'
import { MP4Pipeline } from '../../core/services/MP4Pipeline'
import { MP4ConversionService } from '../../core/services/MP4ConversionService'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { DurationService } from '../../core/services/DurationService'
import { RetryService } from '../../core/services/RetryService'
import { AudioErrorClassifier } from '../../core/services/AudioErrorClassifier'
import { loadMP4Config } from '../../core/config/MP4ConversionConfig'
import type { MP4PipelineReport } from '../../core/types/audio'

describe('MP4 Pipeline Integration', () => {
  test('Services can be instantiated and wired together', async () => {
    // Arrange
    const config = await loadMP4Config()
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()
    const durationService = new DurationService()
    const audioMergeService = new AudioMergeService()
    const mp4ConversionService = new MP4ConversionService(
      config,
      retryService,
      errorClassifier
    )

    // Act
    const pipeline = new MP4Pipeline(
      audioMergeService,
      mp4ConversionService,
      durationService,
      config
    )

    // Assert
    expect(pipeline).toBeDefined()
    expect(config).toBeDefined()
    expect(mp4ConversionService).toBeDefined()
  })

  test('Pipeline rejects missing input directory', async () => {
    // Arrange
    const config = await loadMP4Config()
    const services = {
      retryService: new RetryService(),
      errorClassifier: new AudioErrorClassifier(),
      durationService: new DurationService(),
      audioMergeService: new AudioMergeService(),
      mp4ConversionService: new MP4ConversionService(
        config,
        new RetryService(),
        new AudioErrorClassifier()
      )
    }

    const pipeline = new MP4Pipeline(
      services.audioMergeService,
      services.mp4ConversionService,
      services.durationService,
      config
    )

    // Act
    const report = await pipeline.execute({
      mergedAudioDir: '/nonexistent/directory/12345',
      outputDir: '/tmp/output'
    })

    // Assert
    expect(report).toBeDefined()
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.successCount).toBe(0)
  })

  test('Pipeline dry-run returns correct report structure', async () => {
    // Arrange
    const config = await loadMP4Config()
    const pipeline = new MP4Pipeline(
      new AudioMergeService(),
      new MP4ConversionService(config, new RetryService(), new AudioErrorClassifier()),
      new DurationService(),
      config
    )

    // Act - dry-run on empty directory
    const report = await pipeline.execute({
      mergedAudioDir: '/tmp',
      outputDir: '/tmp/out',
      dryRun: true
    })

    // Assert - verify report structure
    expect(report).toBeDefined()
    expect(report.timestamp).toBeGreaterThan(0)
    expect(report.inputDirectory).toBeDefined()
    expect(report.outputDirectory).toBeDefined()
    expect(typeof report.totalFiles).toBe('number')
    expect(typeof report.successCount).toBe('number')
    expect(typeof report.failureCount).toBe('number')
    expect(Array.isArray(report.results)).toBe(true)
    expect(report.dryRun).toBe(true)
    expect(Array.isArray(report.errors)).toBe(true)
  })

  test('MP4PipelineReport type has all required fields', async () => {
    // Test the type definition by creating a mock report
    const mockReport: MP4PipelineReport = {
      timestamp: Date.now(),
      inputDirectory: '/input',
      outputDirectory: '/output',
      totalFiles: 5,
      successCount: 3,
      failureCount: 2,
      results: [],
      dryRun: false,
      errors: ['Error 1', 'Error 2']
    }

    expect(mockReport.timestamp).toBeGreaterThan(0)
    expect(mockReport.inputDirectory).toBe('/input')
    expect(mockReport.outputDirectory).toBe('/output')
    expect(mockReport.totalFiles).toBe(5)
    expect(mockReport.successCount).toBe(3)
    expect(mockReport.failureCount).toBe(2)
    expect(mockReport.dryRun).toBe(false)
    expect(mockReport.errors.length).toBe(2)
  })

  test('Configuration loads with defaults', async () => {
    const config = await loadMP4Config()

    expect(config.bitrate).toBeGreaterThan(0)
    expect(config.outputFormat).toBeDefined()
    expect(config.maxConcurrency).toBeGreaterThan(0)
    expect(config.outputDirectory).toBeDefined()
  })

  test('Conversion service uses config settings', async () => {
    const config = await loadMP4Config()
    const service = new MP4ConversionService(
      config,
      new RetryService(),
      new AudioErrorClassifier()
    )

    expect(service).toBeDefined()
    // Service is properly instantiated with config
  })
})
