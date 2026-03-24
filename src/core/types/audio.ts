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
