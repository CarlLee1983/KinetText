/**
 * Audio conversion type definitions
 * Provides TypeScript interfaces for the audio conversion pipeline
 */

/**
 * Configuration options for audio conversion
 */
export interface AudioConvertConfigOptions {
  /** Output bitrate (e.g., '128k', '192k', '320k') */
  bitrate?: string
  /** Sample rate in Hz (22050, 44100, or 48000) */
  sampleRate?: number
  /** Maximum concurrent conversions (1-16) */
  maxConcurrency?: number
  /** FFmpeg operation timeout in milliseconds */
  ffmpegTimeoutMs?: number
}

/**
 * Metadata extracted from an audio file
 */
export interface AudioMetadata {
  /** Duration in seconds (float) */
  readonly duration: number
  /** Audio codec name (e.g., 'MP3', 'FLAC', 'AAC') */
  readonly codec: string
  /** Bitrate in bits/second */
  readonly bitrate: number
  /** Sample rate in Hz */
  readonly sampleRate: number
}

/**
 * Result of a successful audio conversion
 */
export interface ConversionResult {
  /** Absolute path to the input file */
  readonly inputPath: string
  /** Absolute path to the output file */
  readonly outputPath: string
  /** Conversion wall-clock time in milliseconds */
  readonly durationMs: number
  /** Detected input format (e.g., 'WAV', 'AAC', 'OGG', 'FLAC') */
  readonly inputFormat: string
  /** Metadata of the output (converted) file */
  readonly outputMetadata: AudioMetadata
}

/**
 * Error that occurred during conversion of a single file
 */
export interface ConversionError {
  /** Absolute path to the file that failed */
  readonly inputPath: string
  /** The error that was thrown */
  readonly error: Error
  /** Number of retry attempts made before giving up */
  readonly retryAttempts: number
}

/**
 * Result of a batch conversion operation
 */
export interface ConversionBatchResult {
  /** Total number of files in the batch */
  readonly total: number
  /** Number of files successfully converted */
  readonly succeeded: number
  /** Number of files that failed to convert */
  readonly failed: number
  /** Individual results (mix of ConversionResult and ConversionError) */
  readonly results: ReadonlyArray<ConversionResult | ConversionError>
  /** Total wall-clock time for the entire batch in milliseconds */
  readonly totalDurationMs: number
}

/**
 * Report of duration calculation and tolerance validation for a set of files
 */
export interface DurationReport {
  /** Per-file duration breakdown */
  readonly files: ReadonlyArray<{ path: string; duration: number }>
  /** Sum of all file durations in seconds */
  readonly totalDuration: number
  /** Target duration in seconds */
  readonly targetDuration: number
  /** Whether total duration is within the specified tolerance of target */
  readonly withinTolerance: boolean
  /** Tolerance percentage used for validation (e.g., 10 means ±10%) */
  readonly tolerancePercent: number
}

/**
 * Summary of a single merge group's results
 */
export interface GroupSummary {
  /** 0-based group index */
  readonly groupIndex: number
  /** Absolute path to the merged output file */
  readonly outputPath: string
  /** Input files in this group (ordered) */
  readonly inputFiles: ReadonlyArray<string>
  /** Estimated total duration before merge (sum of input durations) */
  readonly estimatedDuration: number
  /** Actual duration of merged output file (re-read via music-metadata) */
  readonly actualDuration: number
  /** Whether actualDuration is within tolerance of target */
  readonly withinTolerance: boolean
  /** True if this group has a single file that exceeds the upper bound */
  readonly oversizedSingleFile: boolean
  /** Merge operation result (timing, file count) */
  readonly mergeResult: {
    readonly outputPath: string
    readonly fileCount: number
    readonly durationMs: number
  }
}

/**
 * Complete report of a batch merge operation
 */
export interface GroupingReport {
  /** Total number of input files processed */
  readonly totalInputFiles: number
  /** Number of groups created */
  readonly totalGroups: number
  /** Target duration per group in seconds */
  readonly targetDurationSeconds: number
  /** Tolerance percentage used */
  readonly tolerancePercent: number
  /** Per-group summaries */
  readonly groups: ReadonlyArray<GroupSummary>
  /** Sum of all input file durations */
  readonly totalInputDurationSeconds: number
  /** Number of groups merged successfully */
  readonly succeeded: number
  /** Number of groups that failed to merge */
  readonly failed: number
  /** ISO 8601 timestamp of report generation */
  readonly generatedAt: string
}
