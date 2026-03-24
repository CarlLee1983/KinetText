---
status: testing
phase: 03-audio-merge
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md]
started: 2026-03-24T12:45:00Z
updated: 2026-03-24T12:45:00Z
---

## Current Test

number: 1
name: mergeBatch() returns complete GroupingReport
expected: |
  Call mergeBatch() with 5 test audio files (total ~30 seconds) grouped into 2 groups.
  Result should be a GroupingReport object containing:
  - groups[] array with 2 items
  - Each group has: files[], estimatedDuration, actualDuration, oversizedSingleFile flag
  - report.totalFiles = 5
  - report.totalDuration ≈ original total (±1% accuracy)
awaiting: user response

## Tests

### 1. mergeBatch() returns complete GroupingReport
expected: mergeBatch() with 5 test audio files returns GroupingReport with groups[], totalFiles, totalDuration fields
result: pending

### 2. Post-merge actualDuration matches estimatedDuration
expected: GroupingReport.groups[].actualDuration is within ±1% of estimatedDuration (re-read via music-metadata post-merge)
result: pending

### 3. CLI --mode=duration groups files by time
expected: Running CLI with --mode=duration --target=20 --tolerance=10 groups files into time-based groups (not count-based)
result: pending

### 4. CLI --mode=duration outputs human-readable report
expected: CLI with --mode=duration outputs formatted Chinese report to stdout with group-by-group status (estimated vs actual duration, tolerance check)
result: pending

### 5. CLI --report flag exports JSON GroupingReport
expected: CLI with --report=/tmp/report.json writes valid JSON GroupingReport to file (parseable, contains groups[], totalFiles, totalDuration)
result: pending

### 6. CLI --dry-run shows grouping preview
expected: CLI with --mode=duration --dry-run shows file count and estimated duration per group WITHOUT performing actual merges or FFmpeg calls
result: pending

### 7. CLI --mode=count behavior unchanged
expected: CLI with --mode=count (or no --mode flag) produces same output as before (sequential merge, group-by-count, not duration)
result: pending

### 8. parseDurationArg() accepts multiple formats
expected: Duration argument parsing supports: raw seconds (3600), hours (1h), minutes (60m) — all resolve to equivalent seconds value
result: pending

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet]
