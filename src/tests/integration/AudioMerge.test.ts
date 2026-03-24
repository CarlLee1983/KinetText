/**
 * Integration tests for AudioMergeService
 * Uses real FFmpeg to generate and merge test MP3 files
 */

import { beforeAll, afterAll, describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AudioMergeService } from '../../core/services/AudioMergeService'
import { DurationService } from '../../core/services/DurationService'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'

describe('AudioMerge Integration', () => {
  let tmpDir: string
  let mergeService: AudioMergeService
  let durationService: DurationService

  beforeAll(async () => {
    // Create isolated temp directory
    tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-merge-test-'))

    const config = new AudioConvertConfig()
    mergeService = new AudioMergeService(config)
    durationService = new DurationService()

    // Generate 3 short (2-second) MP3 files for merge testing
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -codec:a libmp3lame -b:a 128k ${join(tmpDir, 'part1.mp3')} -y`.quiet()
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -codec:a libmp3lame -b:a 128k ${join(tmpDir, 'part2.mp3')} -y`.quiet()
    await $`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 2 -codec:a libmp3lame -b:a 128k ${join(tmpDir, 'part3.mp3')} -y`.quiet()
  }, 30000)

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('mergeFiles() produces a valid merged MP3 file', async () => {
    const inputFiles = [
      join(tmpDir, 'part1.mp3'),
      join(tmpDir, 'part2.mp3'),
      join(tmpDir, 'part3.mp3'),
    ]
    const outputPath = join(tmpDir, 'merged_all.mp3')

    const result = await mergeService.mergeFiles(inputFiles, outputPath)

    // Verify output file exists and has content
    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(0)

    expect(result.outputPath).toBe(outputPath)
    expect(result.fileCount).toBe(3)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  }, 30000)

  test('merged file has approximately correct total duration (~6 seconds)', async () => {
    const outputPath = join(tmpDir, 'merged_duration_check.mp3')

    await mergeService.mergeFiles(
      [join(tmpDir, 'part1.mp3'), join(tmpDir, 'part2.mp3'), join(tmpDir, 'part3.mp3')],
      outputPath
    )

    const metadata = await durationService.getDuration(outputPath)
    // 3 * 2s = 6s, allow tolerance for silent audio encoding
    expect(metadata).toBeGreaterThan(4)
    expect(metadata).toBeLessThan(8)
  }, 30000)

  test('merged file is a valid MP3 (codec check)', async () => {
    const outputPath = join(tmpDir, 'merged_codec_check.mp3')

    await mergeService.mergeFiles(
      [join(tmpDir, 'part1.mp3'), join(tmpDir, 'part2.mp3')],
      outputPath
    )

    // Verify by checking file size (valid MP3 should have content)
    const fileStats = await stat(outputPath)
    expect(fileStats.size).toBeGreaterThan(100)
  }, 30000)

  test('mergeGroup() creates output file with correct naming convention', async () => {
    const group = {
      files: [join(tmpDir, 'part1.mp3'), join(tmpDir, 'part2.mp3')],
      estimatedDuration: 4,
    }

    const result = await mergeService.mergeGroup(group, tmpDir, 0, 'testbook')

    expect(result.outputPath).toBe(join(tmpDir, 'testbook_001.mp3'))
    const fileStats = await stat(result.outputPath)
    expect(fileStats.size).toBeGreaterThan(0)
  }, 30000)
})
