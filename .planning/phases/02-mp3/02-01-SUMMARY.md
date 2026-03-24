---
phase: 02-mp3
plan: 01
subsystem: audio-infrastructure
tags: [audio, types, config, error-classification, ffmpeg, tdd]
dependency_graph:
  requires: []
  provides: [AudioConvertConfigOptions, AudioMetadata, ConversionResult, ConversionBatchResult, DurationReport, AudioConvertConfig, AudioErrorClassifier]
  affects: [02-02, 02-03]
tech_stack:
  added: [music-metadata@11.12.3]
  patterns: [immutable-config, error-classifier-inheritance, readonly-interfaces]
key_files:
  created:
    - src/core/types/audio.ts
    - src/config/AudioConvertConfig.ts
    - src/core/services/AudioErrorClassifier.ts
    - src/tests/unit/AudioConvertConfig.test.ts
    - src/tests/unit/AudioErrorClassifier.test.ts
  modified:
    - src/config/defaults.ts
    - src/core/services/index.ts
    - src/core/index.ts
    - package.json
decisions:
  - "AudioErrorClassifier extends ErrorClassifier to inherit HTTP error handling and add FFmpeg-specific patterns"
  - "AudioConvertConfig validates sampleRate against [22050, 44100, 48000] and maxConcurrency between 1-16"
  - "DEFAULT_AUDIO_CONFIG uses 128k bitrate, 44100 Hz, 3 concurrency, 5-minute timeout as production-safe defaults"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-24"
  tasks: 2
  files: 9
---

# Phase 2 Plan 01: Audio Infrastructure Summary

**One-liner:** Audio type contracts, immutable AudioConvertConfig (env-configurable, validated), and AudioErrorClassifier (FFmpeg pattern matching extending Phase 1 ErrorClassifier) with music-metadata installed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install music-metadata + audio types + AudioConvertConfig | d286109 | audio.ts, AudioConvertConfig.ts, defaults.ts, AudioConvertConfig.test.ts |
| 2 | AudioErrorClassifier extending ErrorClassifier | d286109 | AudioErrorClassifier.ts, services/index.ts, core/index.ts, AudioErrorClassifier.test.ts |

## What Was Built

### src/core/types/audio.ts
Defines all type contracts for Phase 2:
- `AudioConvertConfigOptions` - config override shape
- `AudioMetadata` - duration, codec, bitrate, sampleRate (all readonly)
- `ConversionResult` - successful conversion output with metadata
- `ConversionError` - failed conversion with retry count
- `ConversionBatchResult` - batch aggregate with succeeded/failed counts
- `DurationReport` - per-file duration breakdown with tolerance validation

### src/config/AudioConvertConfig.ts
Immutable configuration class following RetryConfig pattern:
- All properties `readonly`
- Validates `maxConcurrency` (1–16), `sampleRate` (22050/44100/48000)
- `static fromEnvironment()` reads `AUDIO_BITRATE`, `AUDIO_SAMPLE_RATE`, `AUDIO_MAX_CONCURRENCY`, `AUDIO_FFMPEG_TIMEOUT_MS`
- Defaults: bitrate='128k', sampleRate=44100, maxConcurrency=3, ffmpegTimeoutMs=300000

### src/core/services/AudioErrorClassifier.ts
Extends base `ErrorClassifier`:
- HTTP Response objects delegated to parent (inherits all HTTP error logic)
- FFmpeg permanent patterns: `NO SUCH FILE`, `INVALID DATA`, `UNSUPPORTED CODEC`, `PERMISSION DENIED`, `INVALID ARGUMENT`, `NO SUCH FILTER`, `UNRECOGNIZED OPTION` → FAIL
- FFmpeg transient patterns: `CANNOT ALLOCATE`, `BROKEN PIPE`, `RESOURCE TEMPORARILY UNAVAILABLE`, `CONNECTION RESET`, `TIMEOUT` → RETRY
- Unknown FFmpeg errors fall through to parent → UNKNOWN/BACKOFF

## Test Results

- AudioConvertConfig: 22 tests — all pass
- AudioErrorClassifier: 16 tests — all pass
- Full suite: 214 tests — all pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/core/types/audio.ts` exists: FOUND
- `src/config/AudioConvertConfig.ts` exists: FOUND
- `src/core/services/AudioErrorClassifier.ts` exists: FOUND
- `src/tests/unit/AudioConvertConfig.test.ts` exists: FOUND
- `src/tests/unit/AudioErrorClassifier.test.ts` exists: FOUND
- Commit d286109: FOUND
