---
phase: 02-mp3
plan: 02
subsystem: audio-convert
tags: [audio, ffmpeg, conversion, retry, tdd, integration-tests, dependency-injection]
dependency_graph:
  requires: [02-01]
  provides: [AudioConvertService, ShellExecutor, MetadataReader, FfmpegChecker]
  affects: [02-03]
tech_stack:
  added: []
  patterns: [dependency-injection, shell-executor-abstraction, p-limit-concurrency, promise-allsettled-batch]
key_files:
  created:
    - src/core/services/AudioConvertService.ts
    - src/tests/unit/AudioConvertService.test.ts
    - src/tests/integration/AudioConversion.test.ts
  modified:
    - src/core/services/index.ts
decisions:
  - "AudioConvertService uses dependency injection (shellExecutor, metadataReader, ffmpegChecker, retryService) instead of module mocking for full testability in Bun"
  - "ShellExecutor interface abstracts Bun.$ calls so unit tests run without real FFmpeg"
  - "convertBatch uses Promise.allSettled() + p-limit for graceful partial failure handling"
  - "OGG test files generated with libopus (not libvorbis) since this FFmpeg 8.0.1 build doesn't include libvorbis"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-24"
  tasks: 2
  files: 4
---

# Phase 2 Plan 02: AudioConvertService Summary

**One-liner:** AudioConvertService with FFmpeg shell integration, dependency-injected testability, batch concurrency via p-limit, and RetryService wrapping -- validated by 15 unit tests and 9 real-FFmpeg integration tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | AudioConvertService unit implementation | 36fe9d8 | AudioConvertService.ts, AudioConvertService.test.ts, services/index.ts |
| 2 | Integration tests with real FFmpeg | 36fe9d8 | AudioConversion.test.ts |

## What Was Built

### src/core/services/AudioConvertService.ts

Core audio conversion service with:
- **`convertToMp3(inputPath, outputPath)`**: Runs `ffmpeg -y -i {input} -codec:a libmp3lame -b:a {bitrate} -ar {sampleRate} {output}` wrapped in `retryService.execute()`. On failure, cleans up partial output file.
- **`convertBatch(files)`**: Uses `pLimit(config.maxConcurrency)` + `Promise.allSettled()` for partial-failure-tolerant parallel conversion. Returns `ConversionBatchResult`.
- **`getMetadata(filePath)`**: Delegates to injected `MetadataReader` (default: music-metadata `parseFile`).
- **`checkFfmpegAvailable()`**: Both static (standalone) and instance method.
- **Dependency injection**: `AudioConvertServiceDeps` interface allows injecting `shellExecutor`, `metadataReader`, `ffmpegChecker`, `retryService` for full unit testability without mocking Bun modules.

### Dependency Injection Architecture

Since `Bun.$` cannot be easily module-mocked in bun:test, AudioConvertService accepts injectable dependencies. This is actually a better design pattern:

```typescript
interface AudioConvertServiceDeps {
  retryService?: RetryService
  shellExecutor?: ShellExecutor     // wraps Bun.$ in production
  metadataReader?: MetadataReader   // wraps music-metadata in production
  ffmpegChecker?: FfmpegChecker     // wraps ffmpeg -version in production
}
```

### Integration Tests (src/tests/integration/AudioConversion.test.ts)

- `beforeAll`: generates 5-second silent test files in WAV, AAC, OGG (libopus), FLAC using real FFmpeg
- Tests: WAV→MP3, AAC→MP3, OGG→MP3, FLAC→MP3, 192k bitrate, getMetadata accuracy, batch all-success, batch partial-failure
- `afterAll`: cleans up temp directory

## Test Results

- AudioConvertService unit: 15 tests — all pass
- AudioConversion integration: 9 tests — all pass
- Full suite: 238 tests — all pass (no regressions)

## Deviations from Plan

**1. [Rule 2 - Missing Critical Functionality] Dependency injection instead of module mocking**
- **Found during:** Task 1 implementation
- **Issue:** Bun.$ cannot be module-mocked via `mock.module('bun', ...)` in bun:test — the mock doesn't intercept the template literal syntax used by AudioConvertService
- **Fix:** Introduced `AudioConvertServiceDeps` interface with injectable `ShellExecutor`, `MetadataReader`, `FfmpegChecker` types. Production code uses defaults (Bun.$ / music-metadata). Tests inject controlled implementations.
- **Files modified:** `src/core/services/AudioConvertService.ts`
- **Commit:** 36fe9d8

**2. [Rule 1 - Bug] OGG test file generation used wrong codec**
- **Found during:** Task 2 integration tests
- **Issue:** FFmpeg 8.0.1 on this system was built without `libvorbis`, so OGG generation failed with "Unknown encoder 'libvorbis'"
- **Fix:** Changed `ffmpeg ... -codec:a libvorbis` to `-codec:a libopus` (which is compiled in per the build flags)
- **Files modified:** `src/tests/integration/AudioConversion.test.ts`
- **Commit:** 36fe9d8

## Self-Check: PASSED

- `src/core/services/AudioConvertService.ts` exists: FOUND
- `src/tests/unit/AudioConvertService.test.ts` exists: FOUND
- `src/tests/integration/AudioConversion.test.ts` exists: FOUND
- Commit 36fe9d8: FOUND
