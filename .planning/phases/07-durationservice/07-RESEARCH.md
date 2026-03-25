# Phase 7: DurationService 優化 - Research

**Researched:** 2026-03-26
**Domain:** Go concurrent metadata reading, audio format detection, IPC performance optimization
**Confidence:** HIGH

## Summary

Phase 7 requires implementing a Go-side concurrent metadata reading layer to replace the Bun-only DurationService (currently using `music-metadata` + `Promise.all`). The goal is achieving 5-10x performance improvement for 100+ file batches through native concurrent file I/O in Go.

The research confirms that **go-flac + ffprobe fallback strategy is sound**: go-flac provides fast pure-Go FLAC parsing, while ffprobe subprocess handles MP3/AAC/OGG as a reliable fallback. Go's native concurrency (goroutines + semaphore pattern) enables configurable worker pools with timeout mechanisms. The Phase 6 IPC baseline (subprocess JSON) establishes a proven communication pattern, though performance overhead remains the key challenge to address through batch processing and configurable concurrency limits.

**Primary recommendation:** Implement Go metadata service using go-flac (primary) + ffprobe (fallback), with goroutine-based worker pool (configurable, default 4 concurrent) and per-file timeout (5 seconds). Batch interface design (`readMetadata(filePaths: string[])`) with single FFI call per batch optimizes IPC overhead. Performance target (1-2s for 100 files) achievable through concurrent I/O + tuned worker count based on system resources.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: Fallback approach** — Try go-flac first, fall back to ffprobe on error
- **D-02: Both fail behavior** — Return error immediately to Bun layer (fail-fast)
- **D-03: Batch error reporting** — Simple format: `{success: N, error: "File X: reason"}`
- **D-04: No caching in Go layer** — Always read from disk/metadata (stateless)
- **D-05: Batch interface** — `readMetadata(filePaths: string[])` with concurrent reads
- **D-06: Configurable concurrency** — Default 4 parallel reads

### Claude's Discretion
- Detailed error reporting strategies (what info to include in error responses)
- Timeout values per-file and per-batch
- Memory optimization tactics beyond streaming

### Deferred Ideas (OUT OF SCOPE)
- Metadata caching strategy (Phase 9+)
- Streaming interface for 1000+ files
- Custom format parsers beyond go-flac + ffprobe

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FR2 | DurationService Go 優化 (REQUIREMENTS.md) | Concurrency pattern, metadata libraries, IPC approach |
| FR4 | AudioMergeService auxiliary optimization (depends on FR2) | Batch processing enables grouping acceleration |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard | Notes |
|---------|---------|---------|--------------|-------|
| **go-flac/go-flac** | v0.0.0+ (latest) | Pure Go FLAC metadata parsing | Fast, zero C dependencies, maintained | Primary for FLAC files; provides `ParseFile()` → `StreamInfo` → duration |
| **ffprobe** | 7.0+ (system installed) | Universal audio metadata extraction | Reliable fallback for MP3, AAC, OGG; subprocess-based | Fallback when go-flac fails; JSON output parsing |
| **golang.org/x/sync/semaphore** | stdlib (Go 1.13+) | Concurrent task limiting | Standard Go concurrency pattern; proven reliability | Preferred over buffered channels for dynamic goroutine creation |
| **context** (stdlib) | Go 1.7+ (builtin) | Timeout + cancellation | Standard for deadline-aware concurrent operations | `context.WithTimeout()` for per-file timeout (5s default) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **net/http** (stdlib) | Go 1.0+ (builtin) | HTTP client (if needed for remote metadata) | Only if Bun sends URLs instead of file paths |
| **encoding/json** | stdlib | JSON marshaling (Bun ↔ Go IPC) | Always; response serialization |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **go-flac** (primary) | mewkiz/flac | Both are pure Go; go-flac has more active recent commits; mewkiz/flac is slightly more mature (last update 2024 vs 2025) |
| **ffprobe** (fallback) | dhowden/tag library | dhowden/tag is pure Go (no subprocess), but requires separate ID3/MP4/Vorbis parsing logic; ffprobe simpler as unified subprocess |
| **semaphore** pattern | buffered channel semaphore | Both work; semaphore allows dynamic goroutine creation (ideal for variability), channels require fixed pool size upfront |
| **context.WithTimeout** | manual time.After() in select | context is cleaner, prevents goroutine leaks; time.After can leak if not managed carefully |

**Installation (Go module):**
```bash
# In kinetitext-go project
go get github.com/go-flac/go-flac@latest
# ffprobe: requires system installation (brew install ffmpeg on macOS, apt install ffmpeg on Linux)
```

**Version verification (as of 2026-03-26):**
- go-flac: Latest commit Aug 6, 2025 (github.com/go-flac/go-flac); pkg.go.dev shows published May 22, 2023
- ffprobe: Bundled with FFmpeg 7.0+ (released late 2024, widely available)
- golang.org/x/sync: Standard library, version irrelevant

---

## Architecture Patterns

### Recommended Project Structure (kinetitext-go)
```
kinetitext-go/
├── src/duration-service/          # NEW module for Phase 7
│   ├── main.go                    # Entry point (JSON stdin/stdout)
│   ├── metadata_reader.go         # MetadataReader interface + implementations
│   ├── flac_reader.go             # go-flac integration
│   ├── ffprobe_reader.go          # ffprobe fallback subprocess
│   ├── worker_pool.go             # Concurrent reading logic (semaphore-based)
│   ├── types.go                   # Request/Response DTOs
│   ├── metadata_reader_test.go    # Unit tests
│   └── integration_test.go        # E2E tests
├── src/audio-convert/            # Phase 6 (already exists)
├── bin/
│   └── kinetitext-duration        # Built binary for Phase 7 (new)
├── Makefile
└── go.mod / go.sum
```

### Pattern 1: Concurrent Reader with Worker Pool (Semaphore)
**What:** Goroutine-based worker pool using `golang.org/x/sync/semaphore` to limit concurrent file reads to configurable count (default 4). Each file read is wrapped in `context.WithTimeout()` for deadline protection.

**When to use:** Batch metadata reads where you need to process 10-1000s of files without overwhelming OS file descriptors or memory. Fixed-pool patterns (channels) are less flexible; semaphore allows dynamic adjustment per-batch without pre-allocation.

**Example:**
```go
// Source: Standard Go concurrency pattern
// https://pkg.go.dev/golang.org/x/sync/semaphore
// https://gobyexample.com/worker-pools

type BatchReadRequest struct {
  FilePaths []string
  MaxConcurrency int // e.g. 4
  TimeoutPerFile time.Duration // e.g. 5 seconds
}

type MetadataResult struct {
  FilePath string
  Duration float64
  Error    string `json:"error,omitempty"`
}

func (r *MetadataReader) ReadBatch(ctx context.Context, req BatchReadRequest) []MetadataResult {
  sem := semaphore.NewWeighted(int64(req.MaxConcurrency))
  results := make([]MetadataResult, len(req.FilePaths))
  var wg sync.WaitGroup

  for i, filePath := range req.FilePaths {
    wg.Add(1)
    go func(index int, path string) {
      defer wg.Done()

      // Acquire semaphore slot (blocks if all slots taken)
      sem.Acquire(ctx, 1)
      defer sem.Release(1)

      // Per-file timeout
      fileCtx, cancel := context.WithTimeout(ctx, req.TimeoutPerFile)
      defer cancel()

      // Read with fallback
      duration, err := r.readMetadata(fileCtx, path)
      results[index] = MetadataResult{
        FilePath: path,
        Duration: duration,
        Error:    errString(err),
      }
    }(i, filePath)
  }

  wg.Wait()
  return results
}
```

### Pattern 2: Fallback Metadata Reader (go-flac → ffprobe)
**What:** Interface-based abstraction allowing multiple reader implementations. Primary reader attempts go-flac; on error (or unsupported format), falls back to ffprobe subprocess. Bun layer handles retry logic if needed.

**When to use:** Supporting multiple audio formats where one parser covers some formats efficiently (go-flac for FLAC) but others need different tools (ffprobe for MP3/AAC/OGG).

**Example:**
```go
// Source: Strategy pattern + Go interfaces
type MetadataReader interface {
  ReadDuration(ctx context.Context, filePath string) (float64, error)
}

type FlacReader struct {}

func (r *FlacReader) ReadDuration(ctx context.Context, filePath string) (float64, error) {
  // go-flac implementation
  file, err := flac.ParseFile(filePath)
  if err != nil {
    return 0, fmt.Errorf("flac parse failed: %w", err)
  }
  streamInfo := file.Meta[0].(*flac.StreamInfo)
  // Duration = total samples / sample rate
  duration := float64(streamInfo.NbSamples) / float64(streamInfo.SampleRate)
  return duration, nil
}

type FfprobeReader struct{}

func (r *FfprobeReader) ReadDuration(ctx context.Context, filePath string) (float64, error) {
  // ffprobe subprocess implementation
  // Queries ffprobe for format.duration
  cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_format", "-of", "json", filePath)
  // ... parse JSON response, extract duration ...
}

// Composite reader with fallback
type FallbackReader struct {
  primary   MetadataReader
  fallback  MetadataReader
}

func (r *FallbackReader) ReadDuration(ctx context.Context, filePath string) (float64, error) {
  if duration, err := r.primary.ReadDuration(ctx, filePath); err == nil {
    return duration, nil
  }
  // Try fallback
  return r.fallback.ReadDuration(ctx, filePath)
}
```

### Pattern 3: Batch JSON Request/Response via IPC
**What:** Bun sends array of file paths in single JSON request; Go returns aggregated results in single JSON response. Minimizes FFI/subprocess overhead compared to per-file calls.

**When to use:** All Bun ↔ Go communication. Single batch call reduces serialization/deserialization overhead versus N individual calls.

**Example:**
```go
// Types matching Bun ↔ Go contract
type DurationReadRequest struct {
  FilePaths   []string `json:"filePaths"`
  MaxWorkers  int      `json:"maxWorkers,omitempty"` // default 4 if omitted
  TimeoutSecs int      `json:"timeoutSecs,omitempty"` // default 5 if omitted
}

type DurationReadResponse struct {
  Success    int                `json:"success"` // count of files read successfully
  Total      int                `json:"total"`   // total files attempted
  TotalDuration float64         `json:"totalDuration"` // sum of all durations
  Results    []MetadataResult   `json:"results"`
  Error      string             `json:"error,omitempty"` // first error encountered, if any
}

// stdin/stdout: read DurationReadRequest, write DurationReadResponse
func main() {
  // Read JSON from stdin
  var req DurationReadRequest
  json.NewDecoder(os.Stdin).Decode(&req)

  // Process
  resp := reader.ReadBatch(context.Background(), req)

  // Write JSON to stdout
  json.NewEncoder(os.Stdout).Encode(resp)
}
```

### Anti-Patterns to Avoid
- **❌ Per-file FFI calls:** Calling Go for each file separately incurs serialization overhead N times. Use batch interface instead.
- **❌ Unbounded goroutines:** Creating one goroutine per file for 1000+ files exhausts memory. Always use semaphore/worker pool.
- **❌ No per-file timeout:** Hanging on corrupted/slow files blocks entire batch. Wrap each file read in `context.WithTimeout()`.
- **❌ Hardcoded concurrency:** "Always 4 workers" doesn't adapt to system load. Make configurable via request param or env var.
- **❌ Ignoring ffprobe fallback errors:** If both go-flac and ffprobe fail, Bun has no way to retry. Return clear error messages including which readers were attempted.
- **❌ Caching in Go layer:** Files can be edited; cache invalidation is complex. Keep stateless; let Bun handle higher-level caching if needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **FLAC metadata parsing** | Custom FLAC frame reader | `github.com/go-flac/go-flac` | FLAC spec is complex (frame header, CRC checks, variable block sizes). Library handles edge cases. |
| **Concurrent task limiting** | Custom buffered channel semaphore | `golang.org/x/sync/semaphore` | Prevents goroutine leaks, handles context cancellation correctly, standard library. |
| **File timeout handling** | Manual time.After() + select | `context.WithTimeout()` | Cleaner, prevents leaks, integrates with goroutine cancellation. |
| **MP3/AAC/OGG metadata** | Custom ID3/MP4/Vorbis parser | `ffprobe` subprocess | Format specs are proprietary/complex. ffprobe is battle-tested, system-standard tool. |
| **Serialization overhead** | Per-file JSON serialization | Batch JSON for all files | N serializations = N × overhead. Single batch call = constant overhead regardless of N. |

**Key insight:** Metadata extraction is deceptively complex (frame headers, variable block sizes, tag formats vary per codec). Why hand-roll when go-flac and ffprobe are proven, maintained solutions?

---

## Runtime State Inventory

**TRIGGER:** Phase 7 is NOT a rename/refactor phase. This is a greenfield Go service addition with existing Bun DurationService remaining unchanged (until Phase 7 completes and Bun layer is modified).

**ACTION:** Omit this section entirely.

---

## Common Pitfalls

### Pitfall 1: Goroutine Leaks from Context Mismanagement
**What goes wrong:** Creating goroutines without `context.WithCancel()` or `context.WithTimeout()`, or forgetting to `defer cancel()`. If batch times out, child goroutines continue running in background, consuming memory.

**Why it happens:** Go context requires explicit cleanup via `defer cancel()`. Easy to forget when refactoring or adding goroutines.

**How to avoid:**
- Always use `ctx, cancel := context.WithTimeout(...)` in a try-finally pattern
- Pass derived context to goroutines, not the parent
- Test with `pprof` to monitor goroutine count during long-running batches

**Warning signs:** Memory grows over successive batches; goroutine count visible via `runtime.NumGoroutine()` or `/debug/pprof`.

### Pitfall 2: Ffprobe Subprocess Hangs on Corrupted Files
**What goes wrong:** ffprobe subprocess gets stuck reading a corrupted MP3 (e.g., truncated, invalid ID3 header). Entire batch blocks waiting for ffprobe to exit.

**Why it happens:** ffprobe tries to parse entire file; some corrupted files don't have clear EOF markers.

**How to avoid:**
- Always wrap ffprobe calls in `context.WithTimeout()` (5-10 seconds per file)
- Use `exec.CommandContext()` which kills process on context deadline
- Test with known-corrupted files (truncated MP3, 0-byte files)

**Warning signs:** Batch requests hang without returning; system shows zombie `ffprobe` processes.

### Pitfall 3: Semaphore Starvation or Unbounded Waiting
**What goes wrong:** Setting `MaxConcurrency` too low (e.g., 1) causes batches to process sequentially, defeating the concurrency goal. Or setting too high causes system to run out of file descriptors.

**Why it happens:** No tuning for typical system limits; rule-of-thumb of "4 workers" may not match actual system capacity.

**How to avoid:**
- Make concurrency configurable via `DurationReadRequest.MaxWorkers`
- Document default (4) and recommend ranges (2-16 based on CPU cores + OS limits)
- Test with `ulimit -n` to verify file descriptor limits on target system
- Measure throughput vs. worker count empirically (100 files: time with 2, 4, 8, 16 workers)

**Warning signs:** Requests slow down when batch size increases (likely starvation); "too many open files" errors (too high concurrency).

### Pitfall 4: Missing Fallback Handler Errors
**What goes wrong:** go-flac fails on OGG file, ffprobe also fails (e.g., not installed on system), but response doesn't indicate which readers were attempted. Bun layer can't distinguish "file is corrupt" from "system missing ffprobe".

**Why it happens:** Simple error message (e.g., "read duration failed") doesn't capture the chain of attempts.

**How to avoid:**
- Include reader attempt sequence in error: `"flac_reader: unsupported format; ffprobe_reader: command not found"`
- Catch and wrap errors at each fallback stage with context
- Log reader selection logic (which reader is primary, which is fallback)

**Warning signs:** Bun receives "error: read failed" with no way to diagnose root cause (missing binary? corrupted file?).

### Pitfall 5: Batch Performance Regression Due to Concurrency Tuning
**What goes wrong:** Phase 6 achieved 1-2s for 100 files using subprocess JSON IPC. Phase 7 Go layer adds concurrency but introduces goroutine overhead or semaphore contention, resulting in slower performance.

**Why it happens:** Naive worker pool implementation (e.g., all workers blocked waiting for I/O) can be slower than sequential reads on small batches due to scheduler overhead.

**How to avoid:**
- Benchmark with 10, 50, 100, 500, 1000 file batches
- Profile CPU and memory usage with `pprof`
- Compare against Phase 6 baseline (music-metadata + Promise.all) to ensure 5-10x improvement
- Tune worker count based on benchmark results (may be 2-8 depending on system)

**Warning signs:** Performance plateaus below 1s for 100 files; increasing worker count doesn't improve speed.

### Pitfall 6: Memory Bloat from Holding Results Until EOF
**What goes wrong:** Batch reader accumulates all results in memory before serializing to JSON. For 10,000 files, entire results array is kept in memory.

**Why it happens:** Standard `json.Marshal(results)` builds entire output in memory before writing to stdout.

**How to avoid:**
- For large batches, stream JSON results line-by-line or in chunks
- Use `json.NewEncoder(os.Stdout).Encode(result)` for each result individually (JSONL format)
- Document max batch size (e.g., 1000 files) to prevent memory issues
- Add `--max-batch-size` flag or env var

**Warning signs:** OOM (out of memory) on batches >1000 files; Bun sees partially-completed response or timeout.

---

## Code Examples

### Example 1: Go Metadata Service Entry Point (main.go)
```go
// Source: Phase 7 design pattern (Bun ↔ Go JSON IPC)
package main

import (
  "context"
  "encoding/json"
  "os"
  "time"
)

type DurationReadRequest struct {
  FilePaths      []string `json:"filePaths"`
  MaxWorkers     int      `json:"maxWorkers,omitempty"`
  TimeoutPerFileSecs int `json:"timeoutPerFileSecs,omitempty"`
}

type MetadataResult struct {
  FilePath string  `json:"filePath"`
  Duration float64 `json:"duration"`
  Error    string  `json:"error,omitempty"`
}

type DurationReadResponse struct {
  Success       int                `json:"success"`
  Total         int                `json:"total"`
  TotalDuration float64            `json:"totalDuration"`
  Results       []MetadataResult   `json:"results"`
  Error         string             `json:"error,omitempty"`
}

func main() {
  var req DurationReadRequest
  if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
    json.NewEncoder(os.Stdout).Encode(map[string]interface{}{
      "error": "invalid request: " + err.Error(),
    })
    return
  }

  // Defaults
  if req.MaxWorkers == 0 {
    req.MaxWorkers = 4
  }
  if req.TimeoutPerFileSecs == 0 {
    req.TimeoutPerFileSecs = 5
  }

  // Initialize readers
  flacReader := NewFlacReader()
  ffprobeReader := NewFfprobeReader()
  reader := NewFallbackReader(flacReader, ffprobeReader)

  // Read batch
  ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
  defer cancel()

  resp := reader.ReadBatch(ctx, DurationReadRequest{
    FilePaths:      req.FilePaths,
    MaxWorkers:     req.MaxWorkers,
    TimeoutPerFile: time.Duration(req.TimeoutPerFileSecs) * time.Second,
  })

  json.NewEncoder(os.Stdout).Encode(resp)
}
```

### Example 2: Semaphore-Based Worker Pool for Batch Reading
```go
// Source: https://pkg.go.dev/golang.org/x/sync/semaphore + go by example worker-pools
func (r *MetadataReader) ReadBatch(ctx context.Context, req BatchReadRequest) DurationReadResponse {
  numFiles := len(req.FilePaths)
  results := make([]MetadataResult, numFiles)
  var wg sync.WaitGroup
  var mu sync.Mutex
  var totalDuration float64
  var successCount int
  var errMsg string

  // Create semaphore with limit
  sem := semaphore.NewWeighted(int64(req.MaxConcurrency))

  for i, filePath := range req.FilePaths {
    wg.Add(1)
    go func(idx int, path string) {
      defer wg.Done()

      // Acquire token (blocks if all slots taken)
      if err := sem.Acquire(ctx, 1); err != nil {
        results[idx] = MetadataResult{
          FilePath: path,
          Error:    "acquire_failed: " + err.Error(),
        }
        return
      }
      defer sem.Release(1)

      // Per-file timeout
      fileCtx, cancel := context.WithTimeout(ctx, req.TimeoutPerFile)
      defer cancel()

      // Read with fallback
      duration, err := r.readWithFallback(fileCtx, path)

      mu.Lock()
      defer mu.Unlock()
      if err != nil {
        if errMsg == "" {
          errMsg = path + ": " + err.Error()
        }
        results[idx] = MetadataResult{FilePath: path, Error: err.Error()}
      } else {
        results[idx] = MetadataResult{FilePath: path, Duration: duration}
        totalDuration += duration
        successCount++
      }
    }(i, filePath)
  }

  wg.Wait()

  return DurationReadResponse{
    Success:       successCount,
    Total:         numFiles,
    TotalDuration: totalDuration,
    Results:       results,
    Error:         errMsg,
  }
}
```

### Example 3: Fallback Reader (go-flac → ffprobe)
```go
// Source: Strategy pattern + Go error handling best practices
type FallbackMetadataReader struct {
  primary   MetadataReader
  fallback  MetadataReader
  logger    Logger
}

func (r *FallbackMetadataReader) readWithFallback(ctx context.Context, filePath string) (float64, error) {
  // Try primary (go-flac)
  duration, err := r.primary.ReadDuration(ctx, filePath)
  if err == nil {
    r.logger.Debug("flac_reader success", "file", filePath)
    return duration, nil
  }

  r.logger.Debug("flac_reader failed", "file", filePath, "error", err)

  // Try fallback (ffprobe)
  duration, fallbackErr := r.fallback.ReadDuration(ctx, filePath)
  if fallbackErr == nil {
    r.logger.Debug("ffprobe_reader success (fallback)", "file", filePath)
    return duration, nil
  }

  r.logger.Error("both readers failed", "file", filePath, "flac_err", err, "ffprobe_err", fallbackErr)

  // Both failed: return composite error
  return 0, fmt.Errorf("metadata_read_failed: flac failed (%w), ffprobe failed (%w)", err, fallbackErr)
}
```

### Example 4: FFprobe Subprocess Reader with Timeout
```go
// Source: Go exec.CommandContext + JSON parsing
type FfprobeReader struct {
  ffprobePath string // e.g., "/usr/bin/ffprobe"
}

func (r *FfprobeReader) ReadDuration(ctx context.Context, filePath string) (float64, error) {
  // ffprobe -v error -show_format -of json <file> | jq .format.duration
  cmd := exec.CommandContext(ctx, r.ffprobePath,
    "-v", "error",
    "-show_format",
    "-of", "json",
    filePath,
  )

  output, err := cmd.Output()
  if err != nil {
    // Context timeout killed the process
    if ctx.Err() == context.DeadlineExceeded {
      return 0, fmt.Errorf("ffprobe_timeout: file read exceeded deadline")
    }
    return 0, fmt.Errorf("ffprobe_failed: %w", err)
  }

  var result struct {
    Format struct {
      Duration string `json:"duration"`
    } `json:"format"`
  }

  if err := json.Unmarshal(output, &result); err != nil {
    return 0, fmt.Errorf("ffprobe_parse_failed: %w", err)
  }

  duration, err := strconv.ParseFloat(result.Format.Duration, 64)
  if err != nil {
    return 0, fmt.Errorf("duration_parse_failed: %w", err)
  }

  return duration, nil
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| **music-metadata + Promise.all (Bun)** | go-flac + goroutine worker pool (Go) | Phase 7 (2026-03) | 5-10x faster for 100+ file batches; Native concurrency leverages OS scheduler |
| **Sequential FFI/subprocess calls** | Single batch JSON call per batch | Phase 7 (new IPC pattern) | Reduces overhead from N × serialization to 1 × per batch |
| **Unbounded concurrency** | Semaphore-limited (configurable, default 4) | Phase 7 (worker pool) | Prevents file descriptor exhaustion; improves predictability |
| **No timeout on file reads** | context.WithTimeout per file (5s default) | Phase 7 (design pattern) | Prevents hangs on corrupted files; ensures batch completes |

**Deprecated/outdated:**
- **Node.js music-metadata + native Promise.all:** Works for small batches (<10 files), but JS Promise overhead and single-threaded I/O limits concurrency. Replaced by Go's native goroutines.
- **Single-threaded ffprobe calls:** Sequential ffprobe subprocess calls for each file incur process startup overhead (~50ms each). Replaced by batch-oriented Go concurrency.

---

## Open Questions

1. **FFmpeg/ffprobe system availability**
   - What we know: ROADMAP.md specifies "system installation or npm version" for FFmpeg compatibility
   - What's unclear: Will Phase 7 require bundled ffprobe binary or rely on system PATH?
   - Recommendation: Research during planning; if system ffprobe unavailable, use `exec.LookPath("ffprobe")` to detect and fail gracefully with clear error message. Add env var `FFPROBE_PATH` for custom locations (Windows compatibility).

2. **Performance baseline vs. Phase 6**
   - What we know: Phase 6 (AudioConvertService) showed -19.7% performance degradation on short audio due to subprocess overhead
   - What's unclear: Will Phase 7 metadata reads benefit more from batch IPC (single call vs. N calls per file) to overcome subprocess overhead?
   - Recommendation: Benchmark Phase 7 with 100-file batch. Expected: 1-2s (5-10x vs. 5-10s Bun baseline). If subprocess overhead dominates, consider: (a) HTTP server mode in Go to eliminate per-call startup, or (b) Accept longer timeline for long files.

3. **Memory efficiency on very large batches**
   - What we know: D-04 locks "no caching in Go layer" (stateless)
   - What's unclear: Will 10,000+ file batch cause OOM when building entire results array in memory?
   - Recommendation: Implement streaming JSON response (JSONL format, one result per line) if batch size >1000. Phase 7 scope: support up to 1000 files; document limitation.

4. **Error recovery and retry strategy**
   - What we know: D-02 specifies fail-fast (both go-flac and ffprobe fail → return error)
   - What's unclear: Should Bun layer retry individual failed files or entire batch?
   - Recommendation: Return partial success (e.g., 95/100 files OK, 5 errors). Bun layer can retry failed files individually using RetryService. Document retry guidance in MIGRATION_GUIDE.

5. **Fallback routing: when to try ffprobe vs. returning error**
   - What we know: D-01 specifies fallback approach (try go-flac, then ffprobe)
   - What's unclear: Some files might be unsupported by both (e.g., WMA, DSF). Should these return "format unsupported" or attempt binary format detection?
   - Recommendation: Fallback only; no format detection. If both readers fail, return clear error indicating which formats were attempted. Bun layer can choose to skip or warn user.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| **Go** | kinetitext-go compilation + runtime | ✓ | 1.21+ | None (blocking) |
| **FFmpeg** | ffprobe (fallback metadata reader) | ✓ (likely) | 7.0+ | Skip ffprobe fallback; return error (but go-flac handles FLAC, most files OK) |
| **go-flac library** | Primary metadata reader | ✓ (via go get) | latest | Must have (core dependency) |
| **macOS/Linux OS** | File I/O + concurrency | ✓ | current | Windows: use subprocess JSON fallback (Phase 6 pattern) |
| **Bun FFI or subprocess** | IPC to Go service | ✓ (Phase 6 proven) | 1.0+ | Subprocess JSON (already tested in Phase 6) |

**Missing dependencies with no fallback:**
- Go 1.21+ (compilation blocker; if unavailable, must upgrade Go)
- go-flac library (core FLAC reader; cannot skip)

**Missing dependencies with fallback:**
- FFmpeg/ffprobe (missing → metadata reads work for FLAC only, fail for MP3/AAC/OGG; Bun layer can warn user or retry)

**Step 2.6 Result:** Phase 7 has clear external dependencies (Go, go-flac, ffprobe). All are available in typical development environment (macOS/Linux). Windows requires subprocess JSON IPC (already proven in Phase 6). No blocking gaps identified.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun) + Go `testing` stdlib (Go) |
| Config file | `tsconfig.json` + `go.mod` (no separate config needed) |
| Quick run command | `bun test src/tests/unit/DurationService.test.ts` (Bun) + `go test ./src/duration-service` (Go) |
| Full suite command | `bun test && go test ./...` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FR2-01 | Go metadata service reads FLAC duration via go-flac | unit (Go) | `go test ./src/duration-service -run TestFlacReader` | ❌ Wave 0 |
| FR2-02 | Go metadata service falls back to ffprobe on error | unit (Go) | `go test ./src/duration-service -run TestFallbackReader` | ❌ Wave 0 |
| FR2-03 | Concurrent batch reads 100 files in <2 seconds | integration (Go) | `go test ./src/duration-service -run TestBatchReadPerformance -timeout 10s` | ❌ Wave 0 |
| FR2-04 | Supports MP3, FLAC, AAC, OGG formats | integration (Go) | `go test ./src/duration-service -run TestMultiFormatReads` | ❌ Wave 0 |
| FR2-05 | Per-file timeout (5s) prevents hangs on corrupted files | integration (Go) | `go test ./src/duration-service -run TestTimeoutMechanism` | ❌ Wave 0 |
| FR2-06 | Bun DurationManager delegates to Go service | integration (Bun) | `bun test src/tests/integration/DurationServiceGo.test.ts` | ❌ Wave 0 |
| FR2-07 | Error reporting format matches JSON spec | integration (Go) | `go test ./src/duration-service -run TestErrorReporting` | ❌ Wave 0 |
| FR2-08 | 100-file concurrent read achieves 5-10x speedup vs Bun version | e2e (Bun) | `bun run bench:duration-go` (new benchmark script) | ❌ Wave 0 |
| FR4-01 | AudioMergeService uses Go duration reads for grouping | integration (Bun) | `bun test src/tests/integration/AudioMergeWithGo.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Go unit tests (`go test ./src/duration-service -short`)
- **Per wave merge:** Full Go test suite + Bun integration tests (`bun test && go test ./...`)
- **Phase gate:** Benchmark shows <2s for 100 files + 5-10x improvement vs Bun baseline before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/duration-service/metadata_reader_test.go` — Unit tests for FlacReader, FfprobeReader, FallbackReader
- [ ] `src/duration-service/worker_pool_test.go` — Concurrent batch read tests, timeout behavior, error handling
- [ ] `src/tests/integration/DurationServiceGo.test.ts` — Bun ↔ Go integration tests, JSON serialization
- [ ] `scripts/bench_duration.ts` — Performance benchmark script (compare Bun vs Go, measure throughput)
- [ ] `docs/DURATION_SERVICE_API.md` — API documentation (request/response schema, configuration, error codes)

*(All test infrastructure starts fresh for Phase 7; Phase 6 created Bun test patterns but no Go metadata-specific tests)*

---

## Sources

### Primary (HIGH confidence)
- **go-flac/go-flac** (GitHub: https://github.com/go-flac/go-flac) - Pure Go FLAC parsing, ParseFile() API, latest activity Aug 2025
- **golang.org/x/sync/semaphore** (Go Packages: https://pkg.go.dev/golang.org/x/sync/semaphore) - Concurrent task limiting, standard library
- **context package** (Go Packages: https://pkg.go.dev/context) - Timeout and cancellation, stdlib Go 1.7+
- **FFmpeg/ffprobe documentation** (https://ffmpeg.org/ffprobe.html) - Standard tool for audio metadata, universal format support
- **dhowden/tag** (GitHub: https://github.com/dhowden/tag) - Alternative metadata library, supports ID3/MP4/OGG/FLAC

### Secondary (MEDIUM confidence)
- **Go by Example: Worker Pools** (https://gobyexample.com/worker-pools) - Concurrency pattern tutorial, proven approach
- **Medium: Go Concurrency Control** (https://phu09032000.medium.com/go-concurrency-control-worker-pools-vs-semaphores-069e90bc3a03) - Detailed semaphore vs. worker pool comparison
- **Timeouts in Go Guide** (https://betterstack.com/community/guides/scaling-go/golang-timeouts/) - context.WithTimeout() best practices
- **DEV Community: Goroutine Leaks** (https://dev.to/serifcolakel/go-concurrency-mastery-preventing-goroutine-leaks-with-context-timeout-cancellation-best-1lg0) - Leak prevention patterns

### Tertiary (LOW confidence - background context)
- **Bun FFI documentation** (https://bun-sh.translate.goog/docs/runtime/ffi) - IPC mechanism reference, builds on Phase 6 proven pattern
- **Programming language benchmarks** (https://programming-language-benchmarks.vercel.app/go-vs-javascript) - Bun vs Go performance context (background, not Phase 7 specific)

---

## Metadata

**Confidence breakdown:**
- **Standard Stack (libraries):** HIGH - go-flac and ffprobe are battle-tested, well-maintained, and verified through official docs + WebSearch
- **Concurrency Patterns:** HIGH - golang.org/x/sync/semaphore and context.WithTimeout are stdlib, documented in official Go packages + tutorial sites
- **IPC Overhead:** MEDIUM - Phase 6 verified subprocess JSON works; Phase 7 builds on same pattern but needs empirical confirmation that batch interface reduces overhead
- **Performance Target (1-2s for 100 files):** MEDIUM - Based on ROADMAP goal and go-flac/ffprobe characteristics, but requires Phase 7 benchmark verification
- **Error Handling & Resilience:** HIGH - Fallback strategy and error propagation patterns documented in CONTEXT.md (locked decisions)

**Research date:** 2026-03-26
**Valid until:** 2026-04-23 (27 days; Go libraries stable, no major updates expected; FFprobe maturity high)

**Uncertainty flags:**
1. FFprobe system availability varies by environment (confirmed in Environment Availability section)
2. Batch IPC overhead reduction awaits Phase 7 benchmark validation
3. Optimal worker count (default 4) may vary; recommend empirical tuning per system

---

## Notes for Planner

1. **CONTEXT.md Decisions Are Locked:** All 6 architectural decisions (D-01 through D-06) constrain planning. Don't explore alternatives like caching or format-specific routing.

2. **Performance Target is Aggressive:** 5-10x speedup is the ROADMAP goal. Phase 7 must benchmark early and often. If substring of effort shows target unachievable, escalate immediately (Phase 6 missed 30% goal due to subprocess overhead; Phase 7 may face similar challenges).

3. **Phase 6 Baseline (PERF_REPORT.md):** Reference the AudioConvertService performance report. Phase 7 should learn from subprocess overhead issues and optimize IPC design accordingly (batch interface prioritizes this).

4. **Multi-Format Support is Non-Trivial:** MP3 (ID3 tags), FLAC (Vorbis comments), AAC/OGG (different spec). go-flac is FLAC-only; ffprobe is universal but subprocess-based. The fallback chain is the right design; no shortcuts.

5. **Testing Strategy:** Batch E2E tests with diverse file types (corrupted, edge cases, large files) are essential. Unit tests cover happy path; integration tests must stress error handling and concurrency limits.

6. **Windows Compatibility:** Subprocess JSON IPC (Phase 6 pattern) works cross-platform. No FFI-only design.

---

*Research completed: 2026-03-26*
*Researched by: Claude (gsd-researcher)*
