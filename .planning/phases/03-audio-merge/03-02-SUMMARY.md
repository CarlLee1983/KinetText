---
phase: 03-audio-merge
plan: 02
subsystem: audio
tags: [cli, audio-merge, formatReport, duration-mode, batch-pipeline]

requires:
  - phase: 03-audio-merge
    plan: 01
    provides: mergeBatch(), GroupingReport, GroupSummary interfaces

provides:
  - formatReport() method on AudioMergeService (human-readable Chinese summary)
  - parseDurationArg() helper in merge_mp3.ts (seconds/hours/minutes parsing)
  - CLI --mode=duration flag using mergeBatch() pipeline
  - CLI --target, --tolerance, --report flags for duration mode
  - JSON GroupingReport output via --report flag
  - Dry-run support for duration mode (grouping preview)
  - Backward compatible --mode=count (existing behavior preserved exactly)

affects: [phase-4-mp4]

tech-stack:
  added: []
  patterns:
    - "parseDurationArg pattern: accepts raw seconds, Xh hours, Xm minutes formats"
    - "CLI dual-mode pattern: mode=duration branches early with process.exit(0), mode=count falls through to existing loop"
    - "Dynamic import pattern for AudioMergeService/DurationService in CLI to avoid top-level overhead"

key-files:
  created: []
  modified:
    - src/core/services/AudioMergeService.ts
    - scripts/merge_mp3.ts

key-decisions:
  - "bookName declaration moved before duration mode branch to be accessible in both modes"
  - "Dynamic import used for AudioMergeService in CLI to keep startup fast when not needed"
  - "Duration mode uses process.exit(0) after completion, letting count mode fall through naturally"

patterns-established:
  - "CLI mode branching: validate mode → branch early with exit vs fall-through"
  - "Duration format helper: parseDurationArg() supports 3 formats for user ergonomics"

requirements-completed: [R1.2.2, R1.2.3]

duration: 10min
completed: 2026-03-24
---

# Phase 3 Plan 02: CLI --mode=duration + formatReport() Summary

**CLI upgraded with --mode=duration time-based grouping, formatReport() Chinese summary output, and JSON report export via --report flag with full backward compatibility**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-24T04:45:00Z
- **Completed:** 2026-03-24T04:55:00Z
- **Tasks:** 1 auto (+ 1 checkpoint awaiting verification)
- **Files modified:** 2

## Accomplishments

- Added formatReport() to AudioMergeService for human-readable multi-line Chinese output with group-by-group status (estimated vs actual duration, tolerance check)
- Added parseDurationArg() supporting seconds (39600), hours (11h), minutes (660m)
- Upgraded merge_mp3.ts CLI with --mode, --target, --tolerance, --report flags
- Duration mode: reads durations, groups by time, merges via mergeBatch(), outputs report to stdout and optional JSON file
- Dry-run in duration mode: shows grouping preview (file count, estimated duration per group)
- Backward compatibility: --mode=count (default) is completely unchanged; existing for-loop code untouched

## Task Commits

1. **Task 1: formatReport() + CLI upgrade** - `a3ddf48` (feat)

**Awaiting:** Human verification checkpoint (Task 2)

## Files Created/Modified

- `src/core/services/AudioMergeService.ts` - Added formatReport() method
- `scripts/merge_mp3.ts` - Added parseDurationArg(), new flags, duration mode branch

## Decisions Made

- bookName moved before the duration mode block so it's accessible in both modes without duplication
- Dynamic import pattern used for AudioMergeService in CLI (avoid loading heavy deps when using count mode)

## Deviations from Plan

**1. [Rule 1 - Bug] Moved bookName declaration before duration mode block**
- **Found during:** Task 1 (CLI upgrade)
- **Issue:** bookName was defined after the duration mode block but used inside it
- **Fix:** Moved `const bookName = path.basename(baseDir) || "book"` to before the duration mode `if` block
- **Files modified:** scripts/merge_mp3.ts
- **Committed in:** a3ddf48 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Minor ordering fix, no scope change.

## Issues Encountered

None beyond the bookName ordering fix above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 complete pending manual verification of merged audio continuity
- Phase 4 (MP4 conversion) can begin after checkpoint approval
- CLI fully supports both count-based and duration-based grouping

---
*Phase: 03-audio-merge*
*Completed: 2026-03-24*
