---
phase: 03-audio-merge
plan: 01
subsystem: audio
tags: [audio-merge, p-limit, ffmpeg, music-metadata, batch-pipeline, grouping-report]

requires:
  - phase: 02-mp3
    provides: AudioMergeService (groupByDuration, mergeFiles, mergeGroup), DurationService (getDuration, validateDuration), AudioConvertConfig (maxConcurrency)

provides:
  - GroupSummary interface in src/core/types/audio.ts (per-group merge summary with actualDuration)
  - GroupingReport interface in src/core/types/audio.ts (complete batch report)
  - MergeBatchOptions interface in AudioMergeService
  - mergeBatch() method on AudioMergeService (full pipeline: p-limit reads → group → sequential merge → post-validate → report)
  - 11 new unit tests for mergeBatch()
  - 6 integration tests with real FFmpeg (AudioMergeBatch.test.ts)

affects: [03-02, phase-4-mp4]

tech-stack:
  added: []
  patterns:
    - "mergeBatch() uses p-limit concurrency for metadata reads, sequential for merges to avoid I/O contention"
    - "Post-merge validation pattern: re-read merged output file to confirm actualDuration vs estimatedDuration"
    - "GroupingReport/GroupSummary are fully readonly (immutable) data structures"
    - "Empty input fast path returns immediately without any I/O"

key-files:
  created:
    - src/tests/integration/AudioMergeBatch.test.ts
  modified:
    - src/core/types/audio.ts
    - src/core/services/AudioMergeService.ts
    - src/tests/unit/AudioMergeService.test.ts

key-decisions:
  - "GroupSummary.mergeResult uses inline readonly type to avoid circular imports between audio.ts and AudioMergeService.ts"
  - "mergeBatch() merges groups sequentially (not in parallel) to avoid I/O contention with large files"
  - "p-limit uses config.maxConcurrency for metadata reads to prevent EMFILE on 100+ files"
  - "Post-merge validation re-reads output via music-metadata (not FFprobe) for consistency with Phase 2 approach"

patterns-established:
  - "Batch pipeline pattern: read metadata (p-limit) → group (greedy) → merge (sequential) → validate (re-read) → report"
  - "Test mock pattern: MergeShellExecutor sets output duration in durationMap after mock merge"

requirements-completed: [R1.2.2, R1.2.3]

duration: 12min
completed: 2026-03-24
---

# Phase 3 Plan 01: mergeBatch() Pipeline + GroupingReport Summary

**mergeBatch() pipeline wiring groupByDuration + sequential FFmpeg merge + post-merge music-metadata validation into structured GroupingReport with p-limit concurrency control**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-24T04:33:00Z
- **Completed:** 2026-03-24T04:45:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added GroupSummary and GroupingReport readonly interfaces to audio.ts with all required fields (actualDuration, oversizedSingleFile, generatedAt, etc.)
- Implemented mergeBatch() on AudioMergeService: p-limit metadata reads, greedy grouping, sequential merges, post-merge duration validation, structured report output
- 11 unit tests cover all scenarios: empty input, multi-group splits, actual vs estimated duration, oversized single file, sequential merge order, p-limit usage
- 6 integration tests with real FFmpeg and 10-file batches verifying codec, duration accuracy (<1%), and report structure

## Task Commits

1. **Task 1: GroupSummary/GroupingReport interfaces + mergeBatch() + unit tests** - `0e0135d` (feat)
2. **Task 2: Batch integration tests** - `8c85fd7` (test)

## Files Created/Modified

- `src/core/types/audio.ts` - Added GroupSummary and GroupingReport readonly interfaces
- `src/core/services/AudioMergeService.ts` - Added MergeBatchOptions, mergeBatch() method with p-limit and post-validation
- `src/tests/unit/AudioMergeService.test.ts` - Added mergeBatch describe block with 11 tests
- `src/tests/integration/AudioMergeBatch.test.ts` - Created 6 integration tests with real FFmpeg

## Decisions Made

- Chose inline readonly type for GroupSummary.mergeResult to avoid circular imports between audio.ts and AudioMergeService.ts
- mergeBatch() merges groups sequentially to avoid simultaneous FFmpeg processes competing for I/O on large audio files
- Post-merge validation uses DurationService.getDuration (music-metadata), not FFprobe, consistent with Phase 2 approach

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Test for `failed count increments` initially failed because the RetryService retried the failing shell call and succeeded on retry with `callCount++` logic. Fixed by making the failure permanent (all calls to second output always throw), allowing retry exhaustion and proper `failed++` count in mergeBatch().

## Next Phase Readiness

- mergeBatch() is complete and tested; ready for 03-02 CLI upgrade
- GroupingReport interface stable for formatReport() in 03-02
- All 300 tests pass

---
*Phase: 03-audio-merge*
*Completed: 2026-03-24*
