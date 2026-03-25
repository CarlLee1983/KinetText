# Phase 7: DurationService 優化 - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

---

## Phase Boundary

Implement Go-side concurrent metadata reading layer to optimize audio duration calculation. Migrate DurationService from Bun-only (music-metadata + Promise.all) to Go (go-flac + ffprobe) to achieve 5-10x performance improvement for batch metadata operations (100+ files). Support concurrent reads with configurable concurrency control, handling MP3, FLAC, AAC, OGG formats.

**Deliverables:**
- Go metadata concurrent reading layer (`src/duration-service` module in kinetitext-go)
- go-flac integration (FLAC primary)
- ffprobe fallback (MP3, AAC, OGG)
- Bun DurationManager layer (delegates to Go)
- Concurrent read batching + timeout mechanism
- Integration tests (100+ file batches)
- Documentation

**Acceptance Criteria:**
- 100 file concurrent read: < 2 seconds
- 5-10x faster than Bun version
- 50% memory efficiency improvement
- All formats supported (MP3, FLAC, AAC, OGG)
- Error handling and timeout complete

---

## Implementation Decisions

### Metadata Library Strategy
- **D-01: Fallback approach** — Try go-flac first, fall back to ffprobe on error
  - go-flac is pure Go, fast for FLAC metadata
  - ffprobe provides universal format coverage (MP3, AAC, OGG)
  - Simpler than format-specific routing; parallel attempts are resource-heavy

- **D-02: Both fail behavior** — Return error immediately to Bun layer
  - Fail-fast ensures Bun layer detects corrupted files immediately
  - Bun can retry, retry, or handle per-file failures as needed

### Error Handling & Reporting
- **D-03: Batch error reporting** — Simple format: `{success: N, error: "File X: reason"}`
  - Indicates partial success, shows first error, keeps response payload small
  - Bun layer can retry individual files if needed
  - No need for detailed per-file error maps on every call

### Performance & Caching
- **D-04: No caching in Go layer** — Always read from disk/metadata
  - Keeps Go service stateless and simple
  - Files can change (user edits metadata, replaces files), so cache invalidation is complex
  - One Go process lifetime is typically short; restart would invalidate cache anyway

### Bun-Go Interface (IPC Layer)
- **D-05: Batch interface** — `readMetadata(filePaths: string[])`
  - Bun sends array of file paths, Go reads concurrently (configurable, default 4 parallel)
  - Single FFI call per batch, Go handles internal concurrency control
  - Simpler Bun layer (no FFI call management), optimal Go utilization
  - Response: `{success: N, error?: string}` plus duration results

### Concurrency Control
- **D-06: Configurable concurrency** — Default 4 parallel reads
  - Based on ROADMAP.md decision
  - Prevents system overload on very large batches
  - Configurable via environment or Bun init parameter for tuning

---

## Canonical References

### Go Dependencies
- `go-flac` — Pure Go FLAC metadata reader (primary)
- `ffprobe` — Fallback for MP3, AAC, OGG format detection

### Related Architecture Docs
- `.planning/ROADMAP.md` § Phase 7 — Full feature specification
- `.planning/REQUIREMENTS.md` § FR2 — DurationService acceptance criteria
- `.planning/phases/06-audio-convert-go/06-VERIFICATION.md` — Phase 6 baseline (to compare performance)

### Existing Implementation
- `src/core/services/DurationService.ts` — Current Bun implementation using music-metadata
  - Reference: `async calculateTotalDuration(filePaths)` with Promise.all
  - Expected pattern: Bun layer will delegate to Go, not reimplementing
- `src/tests/unit/DurationService.test.ts` — Test patterns to replicate

---

## Existing Code Insights

### Reusable Assets
- **DurationService class structure** — Current Bun service provides interface contract (getDuration, calculateTotalDuration, generateReport)
- **Type definitions** — `DurationReport` and `DurationMetadataReader` interfaces in `src/core/types/audio.ts`
- **Test patterns** — Unit tests use injectable DurationMetadataReader; follow same pattern for Go integration

### Established Patterns
- **Dependency injection** — Services accept Deps interface (seen in Phase 6 wrappers)
- **Logging** — Pino logger pattern (createLogger, logger.info/error)
- **Promise-based async** — Bun layer expects Promises; FFI/subprocess wrapper must wrap Go responses appropriately

### Integration Points
- **DurationService in AudioMergeService** — Uses calculateTotalDuration; will call Go version instead
- **Report generation** — generateReport method combines per-file durations; can reuse after Go layer is integrated
- **Test infrastructure** — jest/bun:test patterns; E2E tests should verify 100+ file batch performance

---

## Specific Ideas

- **Performance measurement baseline:** Compare against current music-metadata + Promise.all baseline (Phase 6 PERF_REPORT.md should have reference)
- **100-file test batch:** Use diverse file types (MP3, FLAC, AAC, OGG) to stress-test fallback logic
- **Timeout mechanism:** Set reasonable per-file timeout (e.g., 5 seconds per file) to prevent hanging on slow reads

---

## Deferred Ideas

- **Metadata caching strategy** — Explored during discussion but deferred: could add in-memory cache layer in Phase 9 if performance plateaus
- **Streaming interface** — Large batch streaming results (1000+ files): more complex, deferred to future optimization phase if needed

---

*Phase: 07-durationservice*
*Context gathered: 2026-03-26*
