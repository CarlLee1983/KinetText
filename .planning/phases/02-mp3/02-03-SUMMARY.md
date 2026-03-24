---
phase: 02-mp3
plan: 03
subsystem: audio-duration-merge
tags: [audio, duration, merging, ffmpeg, concat-demuxer, tdd, greedy-algorithm, integration-tests]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [DurationService, AudioMergeService, MergeGroup, MergeResult, MergeBatchResult]
  affects: []
tech_stack:
  added: []
  patterns: [dependency-injection, greedy-grouping, ffmpeg-concat-demuxer, single-quote-escaping]
key_files:
  created:
    - src/core/services/DurationService.ts
    - src/core/services/AudioMergeService.ts
    - src/tests/unit/DurationService.test.ts
    - src/tests/unit/AudioMergeService.test.ts
    - src/tests/integration/AudioMerge.test.ts
  modified:
    - src/core/services/index.ts
decisions:
  - "DurationService accepts DurationMetadataReader dep injection (same pattern as AudioConvertService) for testability"
  - "AudioMergeService MergeShellExecutor receives concat list content as string (not file path) so tests can verify format without writing temp files"
  - "Greedy algorithm: single oversized file always forms its own group (don't drop files)"
  - "MergeBatchResult exported for future use even though mergeGroup/mergeFiles tested individually"
metrics:
  duration: "~12 minutes"
  completed: "2026-03-24"
  tasks: 2
  files: 6
---

# Phase 2 Plan 03: DurationService and AudioMergeService Summary

**One-liner:** DurationService (duration extraction, tolerance validation ±10%, DurationReport generation, human-readable formatting) and AudioMergeService (greedy grouping algorithm, FFmpeg concat demuxer -c copy, RetryService integration) completing R1.2.2 and R1.2.3.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DurationService with tests | fd1648b | DurationService.ts, DurationService.test.ts, services/index.ts |
| 2 | AudioMergeService with unit and integration tests | fd1648b | AudioMergeService.ts, AudioMergeService.test.ts, AudioMerge.test.ts |

## What Was Built

### src/core/services/DurationService.ts

- **`getDuration(filePath)`**: Delegates to injected `DurationMetadataReader` (default: music-metadata `parseFile`).
- **`calculateTotalDuration(filePaths)`**: Parallel `Promise.all()` over all files, sum result. Returns 0 for empty array.
- **`validateDuration(actual, target, tolerancePercent=10)`**: Returns `actual >= target*(1-tol/100) && actual <= target*(1+tol/100)`.
- **`generateReport(filePaths, targetSeconds=39600, tolerancePercent=10)`**: Returns full `DurationReport` with per-file breakdown, total, target, `withinTolerance` flag.
- **`formatDuration(seconds)`**: Returns `"${h}h ${mm}m ${ss}s"` format (e.g., `"11h 00m 00s"`).

### src/core/services/AudioMergeService.ts

- **`groupByDuration(files, targetSeconds=39600, tolerancePercent=10)`**: Greedy sequential grouping. Upper bound = `targetSeconds * (1 + tolerancePercent/100)`. Oversized single files get their own group (no files dropped).
- **`mergeFiles(filePaths, outputPath)`**: Builds concat list → calls `shellExecutor(listContent, outputPath)` → wrapped in `retryService.execute()`.
- **`mergeGroup(group, outputDir, groupIndex, namePrefix='merged')`**: Convenience wrapper → outputs to `{outputDir}/{namePrefix}_{001..NNN}.mp3`.
- **`buildConcatList(filePaths)`**: Escapes single quotes in paths: `'` → `'\''`. Format per file: `file '/absolute/path'`.
- **`defaultMergeShellExecutor`**: Writes temp list file → runs `ffmpeg -y -f concat -safe 0 -i {listFile} -c copy {outputPath}` → cleans up list in `finally` block.

### MergeShellExecutor Design

Receives concat list content as a string (not a temp file path). This allows unit tests to verify the exact content passed to FFmpeg without writing temp files or mocking file system operations.

## Test Results

- DurationService unit: 21 tests — all pass
- AudioMergeService unit: 17 tests — all pass
- AudioMerge integration: 4 tests — all pass
- Full suite: 280 tests — all pass (no regressions)

## Requirements Satisfied

- **R1.2.2**: AudioMergeService groups files by target duration (default 11h, ±10%) and merges via FFmpeg concat demuxer (-c copy, lossless). Retry integration via RetryService.
- **R1.2.3**: DurationService calculates duration with <1% error (music-metadata), validates against configurable target with tolerance, generates DurationReport with per-file breakdown.

## Deviations from Plan

None — plan executed exactly as written. The dependency injection pattern established in 02-02 was consistently applied here.

## Self-Check: PASSED

- `src/core/services/DurationService.ts` exists: FOUND
- `src/core/services/AudioMergeService.ts` exists: FOUND
- `src/tests/unit/DurationService.test.ts` exists: FOUND
- `src/tests/unit/AudioMergeService.test.ts` exists: FOUND
- `src/tests/integration/AudioMerge.test.ts` exists: FOUND
- Commit fd1648b: FOUND
