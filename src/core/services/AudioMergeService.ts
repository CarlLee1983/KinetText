/**
 * Audio merge service
 * Groups MP3 files by target duration and merges them using FFmpeg concat demuxer
 * Uses -c copy for lossless, fast merging (no re-encoding)
 */

import { $ } from 'bun'
import path from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DurationService } from './DurationService'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import { RetryConfig } from '../../config/RetryConfig'
import { createLogger } from '../utils/logger'

/**
 * A group of MP3 files to be merged together with an estimated total duration.
 */
export interface MergeGroup {
  /** Ordered list of file paths to merge */
  readonly files: ReadonlyArray<string>
  /** Estimated total duration of the group in seconds */
  readonly estimatedDuration: number
}

/**
 * Result of a single merge operation
 */
export interface MergeResult {
  /** Absolute path to the output merged file */
  readonly outputPath: string
  /** Number of input files merged */
  readonly fileCount: number
  /** Wall-clock time for the merge operation in milliseconds */
  readonly durationMs: number
}

/**
 * Result of a batch merge (multiple groups)
 */
export interface MergeBatchResult {
  /** All groups that were merged */
  readonly groups: ReadonlyArray<MergeGroup>
  /** Individual merge results */
  readonly results: ReadonlyArray<MergeResult>
  /** Total number of groups */
  readonly totalGroups: number
  /** Number of groups merged successfully */
  readonly succeeded: number
  /** Number of groups that failed to merge */
  readonly failed: number
}

/**
 * Injectable shell executor type for the merge command.
 * Receives the concat list content (as string) and output path.
 * In production: writes list to temp file, runs FFmpeg, cleans up.
 * In tests: can capture calls without real FFmpeg.
 */
export type MergeShellExecutor = (
  listContent: string,
  outputPath: string
) => Promise<void>

/**
 * Dependencies for AudioMergeService (enables testability)
 */
export interface AudioMergeServiceDeps {
  retryService?: RetryService
  shellExecutor?: MergeShellExecutor
  durationService?: DurationService
}

/**
 * Default FFmpeg concat demuxer shell executor.
 * Writes a temp concat list file, runs ffmpeg, cleans up the list in finally block.
 */
const defaultMergeShellExecutor: MergeShellExecutor = async (listContent, outputPath) => {
  const listFile = join(tmpdir(), `kinetitext_concat_${Date.now()}.txt`)
  try {
    await writeFile(listFile, listContent, 'utf-8')
    const result = await $`ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${outputPath}`.quiet()
    if (result.exitCode !== 0) {
      const stderrText = result.stderr.toString().substring(0, 200)
      throw new Error(`FFmpeg concat failed (exit ${result.exitCode}): ${stderrText}`)
    }
  } finally {
    // Clean up temp list file regardless of success or failure
    try {
      await unlink(listFile)
    } catch {
      // Ignore cleanup errors (file may not exist if writeFile failed)
    }
  }
}

/**
 * Merges MP3 files using FFmpeg concat demuxer.
 * Groups files by target duration using a greedy sequential algorithm.
 * All merges are lossless (-c copy, no re-encoding) and wrapped in RetryService.
 */
export class AudioMergeService {
  private readonly config: AudioConvertConfig
  private readonly durationService: DurationService
  private readonly retryService: RetryService
  private readonly shellExecutor: MergeShellExecutor
  private readonly logger = createLogger('audio-merge')

  constructor(
    config: AudioConvertConfig = new AudioConvertConfig(),
    deps: AudioMergeServiceDeps = {}
  ) {
    this.config = config
    this.durationService = deps.durationService ?? new DurationService()
    const retryConfig = new RetryConfig({
      timeoutMs: config.ffmpegTimeoutMs,
      operationTimeoutMs: config.ffmpegTimeoutMs * 2,
    })
    this.retryService = deps.retryService ?? new RetryService(retryConfig, new AudioErrorClassifier())
    this.shellExecutor = deps.shellExecutor ?? defaultMergeShellExecutor
  }

  /**
   * Group files by target duration using a greedy sequential algorithm.
   *
   * Algorithm: Iterate files in order, accumulate into the current group.
   * Start a new group when adding the next file would exceed the upper tolerance bound,
   * UNLESS the current group is empty (oversized single file gets its own group).
   *
   * Upper bound = targetSeconds * (1 + tolerancePercent / 100)
   *
   * @param files - Array of { path, duration } objects in order
   * @param targetSeconds - Target duration per group (default: 39600 = 11 hours)
   * @param tolerancePercent - Tolerance percentage (default: 10 means ±10%)
   * @returns ReadonlyArray of MergeGroup objects
   */
  async groupByDuration(
    files: ReadonlyArray<{ path: string; duration: number }>,
    targetSeconds: number = 39600,
    tolerancePercent: number = 10
  ): Promise<ReadonlyArray<MergeGroup>> {
    if (files.length === 0) return []

    const upperBound = targetSeconds * (1 + tolerancePercent / 100)
    const groups: Array<{ files: string[]; duration: number }> = []
    let currentFiles: string[] = []
    let currentDuration = 0

    for (const file of files) {
      const wouldExceed = currentDuration + file.duration > upperBound
      if (wouldExceed && currentFiles.length > 0) {
        // Seal current group and start a new one
        groups.push({ files: [...currentFiles], duration: currentDuration })
        currentFiles = [file.path]
        currentDuration = file.duration
      } else {
        // Add to current group (even if single file exceeds upper bound)
        currentFiles.push(file.path)
        currentDuration += file.duration
      }
    }

    // Push remaining files as last group
    if (currentFiles.length > 0) {
      groups.push({ files: currentFiles, duration: currentDuration })
    }

    return groups.map(g => ({
      files: g.files,
      estimatedDuration: g.duration,
    }))
  }

  /**
   * Merge multiple MP3 files into one using FFmpeg concat demuxer.
   * Uses -c copy for lossless, fast merging (no re-encoding).
   *
   * @param filePaths - Ordered list of input file paths
   * @param outputPath - Absolute path for the merged output file
   * @returns MergeResult with timing and file count
   * @throws Error if merge fails after all retries
   */
  async mergeFiles(
    filePaths: ReadonlyArray<string>,
    outputPath: string
  ): Promise<MergeResult> {
    const startMs = Date.now()
    const listContent = this.buildConcatList(filePaths)

    const retryResult = await this.retryService.execute(
      () => this.shellExecutor(listContent, outputPath),
      `merge:${path.basename(outputPath)}`
    )

    if (!retryResult.success) {
      throw retryResult.error ?? new Error(`Failed to merge into ${outputPath}`)
    }

    return {
      outputPath,
      fileCount: filePaths.length,
      durationMs: Date.now() - startMs,
    }
  }

  /**
   * Merge a single group of files with standardized output naming.
   *
   * @param group - MergeGroup from groupByDuration()
   * @param outputDir - Directory for the output file
   * @param groupIndex - 0-based group index (used for naming: 000 → _001.mp3)
   * @param namePrefix - Filename prefix (default: 'merged')
   * @returns MergeResult with output path and timing
   */
  async mergeGroup(
    group: MergeGroup,
    outputDir: string,
    groupIndex: number,
    namePrefix: string = 'merged'
  ): Promise<MergeResult> {
    const paddedIndex = (groupIndex + 1).toString().padStart(3, '0')
    const outputPath = join(outputDir, `${namePrefix}_${paddedIndex}.mp3`)
    return this.mergeFiles(group.files, outputPath)
  }

  /**
   * Build FFmpeg concat list content with proper single-quote escaping.
   * Each line format: file 'absolute/path'
   * Single quotes in paths are escaped per POSIX shell spec: ' → '\''
   *
   * @param filePaths - List of file paths (relative or absolute)
   * @returns Concat list content as string
   */
  private buildConcatList(filePaths: ReadonlyArray<string>): string {
    return filePaths
      .map(fp => `file '${path.resolve(fp).replace(/'/g, "'\\''")}'`)
      .join('\n')
  }
}
