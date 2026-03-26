# Phase 8: MP4ConversionService Go 遷移 - Research

**Researched:** 2026-03-26
**Domain:** Go FFmpeg binding + M4A metadata embedding + Bun-Go IPC
**Confidence:** HIGH

---

## Summary

Phase 8 migrates `MP4ConversionService` (MP3 → M4A conversion) from Bun's FFmpeg subprocess to a new Go module inside `kinetitext-go`. This is the third and final phase of Milestone 2's Bun-Go hybrid optimization. The architecture is already proven: Phase 6 established the Go FFmpeg binding pattern, Phase 7 proved the subprocess JSON IPC pattern works reliably for batch operations.

The critical distinction from Phase 6 is that M4A conversion carries **metadata** (title, artist, album, date, genre, trackNumber, comment). These 7 fields must be serialized through the JSON IPC contract and embedded via FFmpeg's `-metadata` flags in Go. The existing Bun implementation in `ffmpeg-commands.ts` provides the exact FFmpeg command structure to replicate in Go.

The expected approach is: create a new `src/mp4-convert/` module in `kinetitext-go`, add `kinetitext-mp4convert` binary to the Makefile, write a `MP4ConvertGoWrapper.ts` in the Bun layer following the `AudioConvertGoWrapper.ts` pattern exactly, and update `MP4ConversionService` to optionally delegate to Go with graceful fallback. Given the pattern is nearly identical to Phase 6, 3-4 days is a realistic estimate.

**Primary recommendation:** Mirror Phase 6's `audio-convert` module structure for Go, and mirror Phase 6's wrapper pattern for Bun. The existing M4A conversion test suite (`MP4Conversion.e2e.ts`) already covers the validation needed — add a Go-specific E2E test file similar to `AudioConvertGo.e2e.ts`.

---

## User Constraints

> No CONTEXT.md exists for Phase 8. The following constraints come from project-level locked decisions documented in REQUIREMENTS.md, STATE.md, and ROADMAP.md.

### Locked Decisions (from Milestone 2)

- **IPC Protocol:** subprocess JSON (NOT Bun FFI.cdef) — locked in Phase 6, validated in Phase 7
- **FFmpeg binding:** `github.com/u2takey/ffmpeg-go` v0.5.0 — already in go.mod
- **Go project location:** `/Users/carl/Dev/Carl/kinetitext-go/` (sibling repo)
- **Binary naming pattern:** `kinetitext-<module>` (kinetitext-audio, kinetitext-duration)
- **Graceful degradation:** Go failure → automatic fallback to Bun FFmpeg (no service interruption)
- **Lazy initialization:** `initGoBackend()` explicit call, not constructor async
- **Immutability:** All config objects use readonly properties
- **No ContentCleaner or CrawlerEngine migration** — out of scope for Milestone 2

### Claude's Discretion

- Binary name for new module (recommend: `kinetitext-mp4convert` for clarity)
- Exact environment variable naming (recommend: `MP4_GO_ENABLED`, `MP4_GO_BINARY_PATH`, `MP4_GO_TIMEOUT_MS`)
- Whether to reuse `kinetitext-audio` binary or create a new binary (recommend: new binary for separation of concerns)
- Concurrency model for `convertBatch` — Go handles single conversion, concurrency managed by Bun p-limit (same as Phase 6)
- Performance benchmark scope (recommend: 5s and 30s M4A files)

### Deferred Ideas (OUT OF SCOPE)

- ContentCleaner Go migration
- CrawlerEngine rewrite
- Bun FFI.cdef direct binding
- Persistent Go daemon/HTTP server mode
- Cover art embedding (no `MP4Metadata` field exists for it)
- MP4 (video) format Go migration (Bun-only video conversion is acceptable)

---

## Technical Investigation

### 1. Existing Bun Implementation Analysis

The current `MP4ConversionService.ts` uses `buildM4ACommand()` from `ffmpeg-commands.ts`. The FFmpeg command structure is:

```
ffmpeg -y -i <input.mp3> -c:a aac -b:a <bitrate>k -movflags +faststart
  [-metadata title=<escaped>] [-metadata artist=<escaped>]
  [-metadata album=<escaped>] [-metadata date=<escaped>]
  [-metadata genre=<escaped>] [-metadata track=<number>]
  [-metadata comment=<escaped>]
  <output.m4a>
```

The `buildMP4WithVideoCommand()` function (video background) is NOT a priority for Go migration — it requires libx264 and black video stream generation, which adds complexity with low ROI. The Go module should target M4A (audio-only) only.

**Confidence: HIGH** — verified by reading `ffmpeg-commands.ts` and `MP4ConversionService.ts`

### 2. FFmpeg-Go M4A Output Support

The `ffmpeg-go` library already handles M4A via its `KwArgs` mechanism. In `converter.go`, the `buildFFmpegKwArgs` function uses a `switch` on `req.Format`. Adding `m4a` case requires:

```go
case "m4a":
    args["c:a"] = "aac"
    bitrate := req.Bitrate
    if bitrate <= 0 {
        bitrate = 256  // AAC default is 256k (higher than MP3's 192k)
    }
    args["b:a"] = fmt.Sprintf("%dk", bitrate)
    args["movflags"] = "+faststart"
```

Metadata embedding in `ffmpeg-go` uses the `GlobalArgs` or `OutputArgs` mechanism. The cleanest approach is constructing `-metadata key=value` pairs as output arguments passed to the `Output()` call.

**Confidence: HIGH** — verified by reading existing `converter.go` and `ffmpeg-go` usage pattern

### 3. Metadata Serialization Contract

The current `AudioConvertRequest` struct has `InputFile`, `OutputFile`, `Format`, `Bitrate`. A new `MP4ConvertRequest` must extend this with a `Metadata` map or struct.

Option A — Inline struct fields (type-safe):
```go
type MP4ConvertRequest struct {
    InputFile  string            `json:"input_file"`
    OutputFile string            `json:"output_file"`
    Bitrate    int               `json:"bitrate"`
    Metadata   *MP4MetadataGo    `json:"metadata,omitempty"`
}

type MP4MetadataGo struct {
    Title       string `json:"title,omitempty"`
    Artist      string `json:"artist,omitempty"`
    Album       string `json:"album,omitempty"`
    Date        string `json:"date,omitempty"`
    Genre       string `json:"genre,omitempty"`
    TrackNumber int    `json:"track_number,omitempty"`
    Comment     string `json:"comment,omitempty"`
}
```

Option B — `map[string]string` (flexible):
```go
type MP4ConvertRequest struct {
    InputFile  string            `json:"input_file"`
    OutputFile string            `json:"output_file"`
    Bitrate    int               `json:"bitrate"`
    Metadata   map[string]string `json:"metadata,omitempty"`
}
```

**Recommendation: Option A** (inline struct). Matches the existing `MP4Metadata` TypeScript interface exactly, is type-safe, avoids map key errors, and maps cleanly to FFmpeg `-metadata` flags.

**Confidence: HIGH** — pattern established by Phase 6 types.go

### 4. Performance Expectations

Based on Phase 6 benchmark data (5-second audio, Apple Silicon M2):

| Scenario | Bun (current) | Go (expected) | Notes |
|----------|--------------|---------------|-------|
| 5s M4A | ~120ms | ~110-130ms | Startup overhead ~50-80ms dominates |
| 30min M4A | ~18s | ~13-15s | Go I/O pipeline advantage |
| 60min M4A | ~36s | ~25-30s | ~30% improvement expected |

The 30% improvement target is realistic for production-length M4A files (typically 30-60 minutes for audiobook chapters). For short test files (3-5 seconds), Go will show no improvement or slight regression due to process startup overhead — this is expected and documented in Phase 6.

**Confidence: MEDIUM** — extrapolated from Phase 6 benchmark data; actual M4A performance may differ from MP3 due to AAC encoder differences

### 5. Metadata UTF-8 Handling in Go

The existing E2E tests validate Chinese UTF-8 metadata (`測試章節`, `測試作者`, `測試書籍`). Go natively handles UTF-8 strings. FFmpeg accepts UTF-8 metadata values via `-metadata` flags. The `ffmpeg-go` library passes string values directly to FFmpeg without encoding transformation.

Critical note from existing Bun implementation: metadata values use `escapeMetadata()` which wraps strings with `JSON.stringify` to handle special characters. In Go, no equivalent escaping is needed because `ffmpeg-go` passes arguments as a proper argument array (no shell interpolation). This is actually simpler and more correct.

**Confidence: HIGH** — verified by reading `ffmpeg-commands.ts` escaping logic and Go's native UTF-8 support

### 6. Concurrency Model Decision

Phase 6 uses a stateless process model: each `convert()` call spawns a new Go process. The Bun layer handles concurrency via `p-limit` in `convertBatch()`. This is the correct model for Phase 8 because:

1. M4A conversions are long-running (30-60 minutes each in production)
2. The per-call process startup overhead (~50-80ms) is negligible for long audio
3. Matching Phase 6's pattern keeps the architecture consistent
4. `convertBatch()` already uses `p-limit(maxConcurrency)` which remains in Bun

No changes needed to the concurrency model. Go handles one conversion per invocation.

**Confidence: HIGH**

---

## Architecture Review

### How Phase 6 FFmpeg Binding Applies to MP4

The Phase 6 `audio-convert` module already contains the core FFmpeg binding infrastructure:
- `types.go` — JSON request/response types
- `converter.go` — `ConvertAudio()` function using `ffmpeg.Input().Output().Run()`
- `main.go` — stdin JSON reader, process entry point

Phase 8 creates a **parallel module** `mp4-convert` in `kinetitext-go/src/mp4-convert/` that follows the same file structure. The key difference: M4A support and metadata embedding.

**Option: Extend existing `audio-convert` module**

Pros: Fewer binaries, simpler deployment
Cons: Mixes two concerns (audio format conversion vs. MP4/M4A with metadata), adds `MP4Metadata` struct to `AudioConvertRequest` types which muddies the contract

**Option: New `mp4-convert` module (RECOMMENDED)**

Pros: Clean separation, dedicated types, independent binary, matches Makefile pattern (`build-audio`, `build-duration`, add `build-mp4convert`)
Cons: Additional binary to compile and distribute

**Recommendation: New `src/mp4-convert/` module with `kinetitext-mp4convert` binary.**

### Go Module Structure

```
kinetitext-go/
├── src/
│   ├── audio-convert/         (existing)
│   │   ├── types.go
│   │   ├── converter.go
│   │   ├── converter_test.go
│   │   └── main.go
│   ├── duration-service/      (existing)
│   │   ├── types.go
│   │   ├── reader.go
│   │   ├── reader_test.go
│   │   └── main.go
│   └── mp4-convert/           (new - Phase 8)
│       ├── types.go            — MP4ConvertRequest, MP4ConvertResponse, MP4MetadataGo
│       ├── converter.go        — ConvertMP4() function, buildM4AKwArgs(), buildMetadataArgs()
│       ├── converter_test.go   — Unit tests for converter
│       └── main.go             — JSON stdin → ConvertMP4() → JSON stdout
└── bin/
    ├── kinetitext-audio        (existing)
    ├── kinetitext-duration     (existing)
    └── kinetitext-mp4convert   (new - Phase 8)
```

### Bun Layer Structure

```
KinetiText/
├── src/
│   ├── core/
│   │   └── services/
│   │       ├── MP4ConversionService.ts      (modified - add Go delegation)
│   │       └── MP4ConvertGoWrapper.ts       (new - mirrors AudioConvertGoWrapper.ts)
│   └── config/
│       └── MP4ConvertGoConfig.ts            (new - mirrors DurationGoConfig.ts)
└── src/tests/
    ├── integration/
    │   └── MP4ConvertGo.test.ts             (new - integration + perf benchmark)
    └── e2e/
        └── MP4ConvertGo.e2e.ts              (new - E2E validation)
```

### IPC Protocol for MP4 Conversion

**Request (Bun → Go), JSON via stdin:**
```json
{
  "input_file": "/path/to/input.mp3",
  "output_file": "/path/to/output.m4a",
  "bitrate": 256,
  "metadata": {
    "title": "Chapter 1",
    "artist": "Test Author",
    "album": "Test Book",
    "date": "2026-03-26",
    "genre": "Audiobook",
    "track_number": 1,
    "comment": "Auto-generated"
  }
}
```

**Success Response (Go → Bun), JSON via stdout:**
```json
{
  "success": true,
  "output_file": "/path/to/output.m4a"
}
```

**Error Response (Go → Bun), JSON via stdout:**
```json
{
  "success": false,
  "error": "FFmpeg conversion failed: ..."
}
```

Note: The `duration` field is omitted from the response (unlike audio-convert). Duration for M4A is not needed post-conversion; it's read by `DurationService` separately if needed. This simplifies the contract.

### MP4ConversionService Delegation Pattern

Mirrors `AudioConvertService.initGoBackend()` and `convertWithGo()`:

```typescript
// In MP4ConversionService constructor or initGoBackend()
async initGoBackend(): Promise<void> {
  if (!this.config.useGoBackend) return
  // Binary availability check
  // Set this.goWrapper = new MP4ConvertGoWrapper(config)
  // Graceful fallback on failure
}

// In convert():
if (this.goWrapper && this.goBackendInitialized) {
  return await this.convertWithGo(inputPath, outputPath, metadata)
}
// Fallback to existing Bun implementation
```

---

## Design Decisions

### Decision 1: Binary Separation vs. Reuse

**Decision:** Create new `kinetitext-mp4convert` binary.

**Rationale:** The `MP4ConvertRequest` type includes metadata fields not present in `AudioConvertRequest`. Merging them would require optional fields in the shared types and conditional branching in `ConvertAudio()`. A dedicated binary has cleaner types, simpler `main.go`, and is independently deployable.

**Confidence: HIGH**

### Decision 2: Metadata Field Set

**Decision:** Support all 7 fields defined in `MP4Metadata` TypeScript interface: title, artist, album, date, genre, trackNumber, comment.

**Rationale:** The existing Bun implementation already supports all 7. The Go implementation must achieve parity. No new fields are added (cover art, description, etc. are out of scope).

The FFmpeg metadata flag mapping:
| TypeScript field | FFmpeg flag |
|-----------------|-------------|
| title | `-metadata title=...` |
| artist | `-metadata artist=...` |
| album | `-metadata album=...` |
| date | `-metadata date=...` |
| genre | `-metadata genre=...` |
| trackNumber | `-metadata track=...` |
| comment | `-metadata comment=...` |

**Confidence: HIGH** — verified by reading `ffmpeg-commands.ts`

### Decision 3: FFmpeg `-movflags +faststart`

**Decision:** Always include `-movflags +faststart` in the M4A output.

**Rationale:** The existing Bun implementation includes this flag (verified in `ffmpeg-commands.ts`). It moves the MOOV atom to the file header, optimizing streaming. Must be replicated in Go.

In `ffmpeg-go` syntax:
```go
args["movflags"] = "+faststart"
```

**Confidence: HIGH**

### Decision 4: MP4 Video Format (NOT Migrated to Go)

**Decision:** Only M4A (audio-only) conversion is migrated to Go. The `buildMP4WithVideoCommand()` remains Bun-only.

**Rationale:** MP4 video conversion requires `-f lavfi -i color=c=black:s=WxH` video source, libx264 codec, and multi-stream mapping. This is rarely used in production (the audiobook pipeline produces M4A). Adding it to Go would require additional codec testing and is low ROI.

The `MP4ConversionService.convert()` call already checks `this.config.outputFormat`. The Go delegation can be applied only when `outputFormat === 'm4a'`.

**Confidence: HIGH**

### Decision 5: Error Handling Strategy

**Decision:** Go reports errors via JSON response `success: false, error: "..."`. Bun layer throws on `success === false`, which triggers `RetryService` for transient errors.

**Rationale:** Identical to Phase 6 pattern. The `AudioErrorClassifier` already classifies FFmpeg errors. No changes needed to error classification.

**Confidence: HIGH**

### Decision 6: Testing Strategy

**Decision:** Three-layer test coverage following Phase 6/7 patterns:

1. **Go unit tests** (`converter_test.go`) — test `buildM4AKwArgs()`, `buildMetadataArgs()`, input validation, missing file errors
2. **Bun integration tests** (`MP4ConvertGo.test.ts`) — test `MP4ConvertGoWrapper.convert()` directly, including metadata round-trip, performance benchmark (3 file sizes)
3. **Bun E2E tests** (`MP4ConvertGo.e2e.ts`) — test `MP4ConversionService` with `useGoBackend: true`, including Chinese UTF-8 metadata, batch conversion, Bun vs Go quality parity

The existing `MP4Conversion.e2e.ts` E2E suite (13 tests) remains unchanged and continues testing the Bun backend.

**Confidence: HIGH**

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FFmpeg invocation in Go | Custom `exec.Command` | `github.com/u2takey/ffmpeg-go` | Already in go.mod, proven in Phase 6, handles output format KwArgs cleanly |
| Metadata string escaping | Custom escape function | Pass via ffmpeg-go KwArgs directly | ffmpeg-go uses argument arrays, no shell escaping needed |
| Bun subprocess management | Custom process spawner | `Bun.spawn()` pattern from AudioConvertGoWrapper.ts | Proven in Phase 6 and 7 |
| Configuration validation | Hand-written validators | Zod schema (DurationGoConfig.ts pattern) | Consistent with all other configs in the project |
| Test fixtures | Custom MP3 generators | `generateMP3()` from `src/tests/e2e/fixtures.ts` | Already creates valid FFmpeg-generated MP3 files |

**Key insight:** Both the Go FFmpeg binding and the Bun subprocess IPC are already solved problems in this codebase. Phase 8 is assembly of proven patterns, not novel engineering.

---

## Common Pitfalls

### Pitfall 1: FFmpeg `-movflags` Syntax in ffmpeg-go

**What goes wrong:** Using `movflags` without the `+` prefix produces invalid FFmpeg output.

**Why it happens:** FFmpeg expects `+faststart` to append to existing flags. The `ffmpeg-go` KwArgs must pass the value as `"+faststart"` (with plus sign) not `"faststart"`.

**How to avoid:** Use `args["movflags"] = "+faststart"` in `buildM4AKwArgs()`.

**Warning signs:** Output M4A plays but seeking/streaming is slow; FFmpeg stderr shows `movflags` warning.

### Pitfall 2: Metadata with Special Characters

**What goes wrong:** Metadata values containing `=`, `:`, or newlines break FFmpeg `-metadata` flag parsing when passed as a single string.

**Why it happens:** FFmpeg parses `-metadata key=value` where `=` is the delimiter. If `value` contains `=`, it may be misinterpreted.

**How to avoid:** Use `ffmpeg-go`'s `OutputArgs()` mechanism which passes individual `-metadata` `key=value` pairs as separate argument elements in the argument array, not as a single shell string. The Go code should build a `ffmpeg.KwArgs` map for metadata or use explicit `-metadata` output args.

**Warning signs:** Metadata values truncated at `=` character; Chinese characters become garbled (UTF-8 corruption).

**Correct ffmpeg-go approach:**
```go
stream := ffmpeg.Input(req.InputFile).Output(req.OutputFile, args)
// Add metadata as separate output args
for k, v := range metadataArgs {
    stream = stream.WithOutput(ffmpeg.KwArgs{"metadata": fmt.Sprintf("%s=%s", k, v)})
}
// OR use GlobalArgs approach
```

Actually the cleanest approach is building all metadata into the initial `KwArgs` map by passing `-metadata` as repeated args through `OutputArgs` — verify against ffmpeg-go docs.

**Confidence: MEDIUM** — ffmpeg-go metadata flag behavior should be verified with a simple test

### Pitfall 3: Go Process Startup Dominates Short Audio Benchmarks

**What goes wrong:** Performance benchmark shows Go is slower than Bun for short test MP3 files (3-5 seconds).

**Why it happens:** Go runtime startup (~50-80ms) plus subprocess IPC overhead (~10-20ms) dominates when FFmpeg conversion time is only 50-150ms. Phase 6 documented this exact issue.

**How to avoid:** Use longer audio files for the performance benchmark (30-60 seconds minimum). Document in PERF_REPORT.md that short audio shows no improvement — this is expected behavior. Set performance test assertion at reasonable level (< 30 seconds for a 60-second M4A, not < 500ms).

**Warning signs:** Benchmark results showing Go 20-30% slower than Bun — this is normal for short files.

### Pitfall 4: Binary Path Resolution in Tests

**What goes wrong:** E2E tests fail because `kinetitext-mp4convert` binary is not found at the expected relative path.

**Why it happens:** `import.meta.dir` resolves relative to the test file's location, not the project root. The path `../../../../../kinetitext-go/bin/kinetitext-mp4convert` depends on the directory depth.

**How to avoid:** Follow the same pattern as `AudioConvertGoWrapper.ts` which uses:
```typescript
private static goBinaryPath: string = join(
  import.meta.dir,
  '../../../../../kinetitext-go/bin/kinetitext-audio'
)
```
For `MP4ConvertGoWrapper.ts` at the same directory depth, the path is identical except for the binary name. Support override via environment variable `MP4_GO_BINARY_PATH`.

**E2E test graceful degradation:** If binary not found, `console.warn` and skip Go tests (same as `AudioConvertGo.e2e.ts`). This keeps CI friendly when Go binary is not compiled.

### Pitfall 5: `outputFormat` Guard in Service

**What goes wrong:** Go backend is invoked for MP4 video conversion (not just M4A), causing errors.

**Why it happens:** `MP4ConversionService.convert()` handles both `m4a` and `mp4` output formats. If the Go delegation does not check `outputFormat`, video conversion requests will reach the Go binary which only supports M4A.

**How to avoid:** Add a guard in `convertWithGo()`:
```typescript
if (this.config.outputFormat !== 'm4a') {
  // Fall through to Bun implementation
  return this.convertWithBun(inputPath, outputPath, metadata)
}
```

### Pitfall 6: `music-metadata` Validation After Go Conversion

**What goes wrong:** Metadata embedded by Go's FFmpeg is not readable by `music-metadata` (used in E2E assertions).

**Why it happens:** M4A atom structure differences between FFmpeg versions or `movflags` positioning.

**How to avoid:** Include a `parseFile()` assertion in E2E tests after Go conversion, exactly as `MP4Conversion.e2e.ts` does for the Bun backend. This catches any container format issues early.

---

## Code Examples

### Go: MP4ConvertRequest Type (types.go pattern)

```go
// Source: Modeled after kinetitext-go/src/audio-convert/types.go
package main

type MP4ConvertRequest struct {
    InputFile  string         `json:"input_file"`
    OutputFile string         `json:"output_file"`
    Bitrate    int            `json:"bitrate"`
    Metadata   *MP4MetadataGo `json:"metadata,omitempty"`
}

type MP4MetadataGo struct {
    Title       string `json:"title,omitempty"`
    Artist      string `json:"artist,omitempty"`
    Album       string `json:"album,omitempty"`
    Date        string `json:"date,omitempty"`
    Genre       string `json:"genre,omitempty"`
    TrackNumber int    `json:"track_number,omitempty"`
    Comment     string `json:"comment,omitempty"`
}

type MP4ConvertResponse struct {
    Success    bool   `json:"success"`
    OutputFile string `json:"output_file,omitempty"`
    Error      string `json:"error,omitempty"`
}
```

### Go: FFmpeg-Go M4A Conversion with Metadata

```go
// Source: Modeled after kinetitext-go/src/audio-convert/converter.go
import ffmpeg "github.com/u2takey/ffmpeg-go"

func ConvertMP4(req MP4ConvertRequest) (*MP4ConvertResponse, error) {
    if req.InputFile == "" || req.OutputFile == "" {
        return nil, fmt.Errorf("input_file and output_file are required")
    }
    if _, err := os.Stat(req.InputFile); os.IsNotExist(err) {
        return nil, fmt.Errorf("input file not found: %s", req.InputFile)
    }

    bitrate := req.Bitrate
    if bitrate <= 0 {
        bitrate = 256
    }

    outputArgs := ffmpeg.KwArgs{
        "c:a":      "aac",
        "b:a":      fmt.Sprintf("%dk", bitrate),
        "movflags": "+faststart",
    }

    // Add metadata flags
    stream := ffmpeg.Input(req.InputFile).Output(req.OutputFile, outputArgs)
    if req.Metadata != nil {
        stream = addMetadata(stream, req.Metadata)
    }

    err := stream.OverWriteOutput().GlobalArgs("-loglevel", "quiet").Run()
    if err != nil {
        return &MP4ConvertResponse{
            Success: false,
            Error:   fmt.Sprintf("FFmpeg error: %v", err),
        }, nil
    }

    return &MP4ConvertResponse{
        Success:    true,
        OutputFile: req.OutputFile,
    }, nil
}
```

### Bun: MP4ConvertGoWrapper Pattern

```typescript
// Source: Modeled after AudioConvertGoWrapper.ts
// src/core/services/MP4ConvertGoWrapper.ts

export class MP4ConvertGoWrapper {
  private static goBinaryPath: string = join(
    import.meta.dir,
    '../../../../../kinetitext-go/bin/kinetitext-mp4convert'
  )

  static async init(binaryPath: string): Promise<void> {
    const exists = await Bun.file(binaryPath).exists()
    if (!exists) throw new Error(`Go binary not found: ${binaryPath}`)
    MP4ConvertGoWrapper.goBinaryPath = binaryPath
  }

  static async convert(req: MP4ConvertGoRequest): Promise<MP4ConvertGoResponse> {
    const goReq = {
      input_file: req.inputFile,
      output_file: req.outputFile,
      bitrate: req.bitrate ?? 256,
      metadata: req.metadata ? transformMetadataToSnakeCase(req.metadata) : undefined,
    }

    const proc = Bun.spawn([MP4ConvertGoWrapper.goBinaryPath], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    proc.stdin.write(JSON.stringify(goReq))
    proc.stdin.end()

    const [outputText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      return { success: false, error: `Go binary error (exit ${exitCode}): ${stderrText}` }
    }

    const goResp = JSON.parse(outputText.trim()) as GoMP4ConvertResponse
    return { success: goResp.success, outputFile: goResp.output_file, error: goResp.error }
  }
}
```

### Bun: MP4ConvertGoConfig Pattern

```typescript
// Source: Modeled after DurationGoConfig.ts
// src/config/MP4ConvertGoConfig.ts

import { z } from 'zod'

export const MP4ConvertGoConfigSchema = z.object({
  enabled: z.boolean().default(false),  // Off by default (vs DurationGoConfig which is on by default)
  goBinaryPath: z.string().default('../kinetitext-go/bin/kinetitext-mp4convert'),
  timeout: z.number().int().min(5000).default(300000), // 5 minutes (M4A can be 60+ min audio)
})

export type MP4ConvertGoConfig = z.infer<typeof MP4ConvertGoConfigSchema>

export function createMP4ConvertGoConfig(overrides = {}): MP4ConvertGoConfig {
  return MP4ConvertGoConfigSchema.parse({
    enabled: process.env.MP4_GO_ENABLED === 'true',
    goBinaryPath: process.env.MP4_GO_BINARY_PATH ?? undefined,
    timeout: process.env.MP4_GO_TIMEOUT_MS
      ? parseInt(process.env.MP4_GO_TIMEOUT_MS, 10)
      : undefined,
    ...overrides,
  })
}
```

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| ffmpeg-go metadata flag syntax differs from expected | MEDIUM | HIGH | Write unit test against actual FFmpeg output before proceeding to Bun integration |
| Performance target (30%) not met for M4A | MEDIUM | LOW | Already expected: document that short files won't show improvement; success criterion is 30%+ for 30+ minute audio |
| Chinese UTF-8 metadata corrupted by FFmpeg-Go | LOW | HIGH | Covered by existing E2E test pattern; validate early with a quick manual test |
| Go binary not found in CI/CD | LOW | MEDIUM | E2E graceful degradation (warn + skip) pattern from Phase 6 |
| `outputFormat: 'mp4'` video conversion broken by delegation | LOW | MEDIUM | Guard check in `convertWithGo()` before delegation |
| Makefile `build-mp4convert` target conflicts | LOW | LOW | Follow exact Makefile pattern; new PHONY target |

---

## Implementation Roadmap (2-Plan Structure)

### Plan 08-01: Go mp4-convert Module + Bun Wrapper Layer

**Scope:** Go-side implementation + Bun wrapper + basic integration validation

**Tasks:**

1. **Go: Create `src/mp4-convert/` module**
   - `types.go` — MP4ConvertRequest, MP4MetadataGo, MP4ConvertResponse
   - `converter.go` — ConvertMP4(), buildM4AKwArgs(), addMetadataArgs()
   - `main.go` — JSON stdin reader → ConvertMP4() → JSON stdout
   - `converter_test.go` — Unit tests: KwArgs generation, metadata mapping, missing file error
   - Add `build-mp4convert` target to Makefile

2. **Go: Compile and validate binary**
   - `make build-mp4convert` → `bin/kinetitext-mp4convert`
   - Manual CLI test with JSON stdin (short MP3 → M4A with metadata)

3. **Bun: Create `MP4ConvertGoWrapper.ts`**
   - Mirror `AudioConvertGoWrapper.ts` structure exactly
   - Support `init(binaryPath)`, `convert(req)`, `isAvailable()`, `getBinaryPath()`
   - Handle snake_case ↔ camelCase field transformation for metadata

4. **Bun: Create `MP4ConvertGoConfig.ts`**
   - Mirror `DurationGoConfig.ts` with Zod schema
   - Environment variables: `MP4_GO_ENABLED`, `MP4_GO_BINARY_PATH`, `MP4_GO_TIMEOUT_MS`

5. **Bun: Modify `MP4ConversionService.ts`**
   - Add `useGoBackend` option to `MP4ConversionConfig` (or via new `MP4ConvertGoConfig`)
   - Add `initGoBackend()` lazy init method
   - Add `convertWithGo()` private method
   - Guard: only delegate when `outputFormat === 'm4a'`
   - Graceful fallback: Go failure → Bun FFmpeg

6. **Bun: Integration tests** (`src/tests/integration/MP4ConvertGo.test.ts`)
   - Direct `MP4ConvertGoWrapper.convert()` tests (bypassing service layer)
   - Metadata round-trip: all 7 fields (English + Chinese)
   - Error handling: invalid input, missing file
   - Performance baseline: 3-second and 30-second M4A

**Acceptance criteria:**
- `make build-mp4convert` succeeds
- `go test ./src/mp4-convert/...` passes (all unit tests)
- `bun test ./src/tests/integration/MP4ConvertGo.test.ts` passes
- `bun test` (full suite) still passes (no regression)

---

### Plan 08-02: E2E Tests + Performance Validation + Documentation

**Scope:** End-to-end validation, performance benchmarking, documentation update

**Tasks:**

1. **Bun: E2E test suite** (`src/tests/e2e/MP4ConvertGo.e2e.ts`)
   - Scene 1: Basic MP3 → M4A via Go backend (file exists, non-empty, music-metadata parseable)
   - Scene 2: Chinese UTF-8 metadata round-trip
   - Scene 3: All 7 metadata fields embedded and readable
   - Scene 4: Batch conversion (`convertBatch` with Go backend)
   - Scene 5: Bun vs Go quality parity (same input → compare output duration, file validity)
   - Scene 6: Error handling (invalid input → error, graceful fallback if binary absent)
   - Graceful degradation: if `kinetitext-mp4convert` binary absent → `console.warn` + skip

2. **Performance benchmark** (in integration test or standalone bench script)
   - 3-second M4A (Go startup overhead dominates — document expected)
   - 30-second M4A (baseline real-world measurement)
   - 60-second M4A (best case for 30% target)
   - Compare Go vs Bun timing, generate `PERF_REPORT.md`

3. **Documentation updates**
   - Update `docs/ARCHITECTURE.md` — add Phase 8 section (Bun-Go boundary for MP4)
   - Update `docs/MIGRATION_GUIDE.md` — add MP4 Go backend section (4 activation methods)
   - Create `docs/MP4_SERVICE.md` (migration guide specific to MP4, following `DURATION_SERVICE.md` pattern)
   - Update `CHANGELOG.md` for v1.1 milestone completion

4. **Update Makefile** final verification: `make build` builds all three binaries

5. **Final test run:** `bun test` — all tests pass (target: existing 463+ tests + new Phase 8 tests)

**Acceptance criteria (FR3 from REQUIREMENTS.md):**
- MP3 → M4A conversion delegates to Go when `useGoBackend: true`
- All metadata fields (title, artist, album, date, genre, trackNumber, comment) embedded correctly
- Chinese UTF-8 metadata readable via `music-metadata`
- M4A files play correctly in VLC (manual spot check)
- 30%+ performance improvement verified for 30-second+ M4A files
- Full test suite passes
- Documentation complete

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go toolchain | Compile kinetitext-mp4convert | ✓ | go1.25.5 darwin/arm64 | — |
| FFmpeg | M4A conversion | ✓ | 8.0.1 | — |
| Bun | Bun layer, testing | ✓ | 1.3.10 | — |
| `github.com/u2takey/ffmpeg-go` | Go FFmpeg binding | ✓ | v0.5.0 (in go.mod) | — |
| `music-metadata` | E2E metadata validation | ✓ | v11.12.3 (in package.json) | — |
| `kinetitext-go` repo | Go modules | ✓ | `/Users/carl/Dev/Carl/kinetitext-go/` | — |
| `kinetitext-audio` binary | Phase 6 (not Phase 8) | ✓ | Compiled | — |
| `kinetitext-duration` binary | Phase 7 (not Phase 8) | ✓ | 3.1MB compiled | — |

**No blocking dependencies.** All required tools are available. Phase 8 only requires creating a new binary alongside the existing two.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test (built-in) |
| Config file | None — bun:test auto-discovers |
| Quick run command | `bun test ./src/tests/unit/ ./src/tests/integration/` |
| Full suite command | `bun test` |
| Go tests command | `cd ../kinetitext-go && go test ./src/mp4-convert/...` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FR3-1 | MP3 → M4A Go conversion | Integration | `bun test ./src/tests/integration/MP4ConvertGo.test.ts` | ❌ Wave 0 |
| FR3-2 | Metadata: title, artist, album embedded | E2E | `bun test ./src/tests/e2e/MP4ConvertGo.e2e.ts` | ❌ Wave 0 |
| FR3-3 | 30%+ speed improvement (30s+ audio) | Integration perf bench | `bun test ./src/tests/integration/MP4ConvertGo.test.ts` | ❌ Wave 0 |
| FR3-4 | M4A valid in VLC | Manual | Manual spot check | — |
| FR3-5 | Chinese UTF-8 metadata | E2E | `bun test ./src/tests/e2e/MP4ConvertGo.e2e.ts` | ❌ Wave 0 |
| FR3-6 | Graceful fallback to Bun | Integration | `bun test ./src/tests/integration/MP4ConvertGo.test.ts` | ❌ Wave 0 |

### Wave 0 Gaps (created in Plan 08-01 and 08-02)

- [ ] `src/tests/integration/MP4ConvertGo.test.ts` — covers FR3-1, FR3-3, FR3-6
- [ ] `src/tests/e2e/MP4ConvertGo.e2e.ts` — covers FR3-2, FR3-5
- [ ] `kinetitext-go/src/mp4-convert/converter_test.go` — Go unit tests
- [ ] `kinetitext-go/src/mp4-convert/` — new module directory

Existing tests that continue to pass (regression check):
- `src/tests/e2e/MP4Conversion.e2e.ts` — 13 tests (Bun backend, unchanged)
- Full suite: 463+ tests currently passing

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bun subprocess FFmpeg for M4A | Go FFmpeg binding via subprocess JSON IPC | Phase 8 | 30% faster for 30+ min audio |
| Manual FFmpeg args in TypeScript string | `ffmpeg-go` KwArgs type-safe | Phase 6 → Phase 8 | No shell escaping needed |
| Per-format conversion in single binary | Dedicated binary per use case | Phase 8 design decision | Cleaner separation |

**Deprecated/outdated in context of Phase 8:**
- `buildM4ACommand()` in `ffmpeg-commands.ts`: Remains for Bun fallback path, not deprecated, but the primary path moves to Go

---

## Open Questions

1. **ffmpeg-go repeated `-metadata` flag syntax**
   - What we know: `ffmpeg-go` KwArgs is a `map[string]interface{}`. Each key can only appear once in a map, which prevents passing multiple `-metadata` flags via KwArgs.
   - What's unclear: The correct ffmpeg-go API for passing multiple `-metadata key=value` pairs. Options include `OutputArgs()` with raw string slices, or using `ffmpeg.KwArgs{"metadata:title": "value"}` notation.
   - Recommendation: Write a minimal Go test converting a 3-second WAV with metadata before implementing the full module. Validate via `ffprobe -show_tags` that all fields are embedded correctly.

2. **`convertBatch` with Go backend: per-call vs batch**
   - What we know: The current `convertBatch()` uses `p-limit` to launch multiple `convert()` calls in parallel. Each Go call is stateless (new process per invocation).
   - What's unclear: Whether spawning 2-4 Go processes simultaneously causes resource contention on the test machine.
   - Recommendation: Keep the same `p-limit(maxConcurrency)` model from Phase 6. If resource contention is observed, document it but do not change the architecture in Phase 8.

3. **Timeout for long M4A files**
   - What we know: A 60-minute audiobook chapter at 256kbps takes ~36 seconds to convert with Bun FFmpeg. The current `MP4ConversionService` has a `retryMaxAttempts` but no explicit timeout.
   - What's unclear: What timeout value to set in `MP4ConvertGoConfig`. The audio-convert wrapper uses 60 seconds; for M4A that may be insufficient for very long chapters.
   - Recommendation: Set default timeout to 300000ms (5 minutes). Document that users with 3+ hour audio files may need to increase `MP4_GO_TIMEOUT_MS`.

---

## Sources

### Primary (HIGH confidence)

- `/Users/carl/Dev/Carl/KinetiText/src/core/services/MP4ConversionService.ts` — existing Bun implementation analyzed
- `/Users/carl/Dev/Carl/KinetiText/src/core/utils/ffmpeg-commands.ts` — FFmpeg M4A command structure verified
- `/Users/carl/Dev/Carl/KinetiText/src/core/types/audio.ts` — MP4Metadata interface (7 fields) verified
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/converter.go` — ffmpeg-go binding pattern verified
- `/Users/carl/Dev/Carl/kinetitext-go/src/audio-convert/types.go` — JSON contract pattern verified
- `/Users/carl/Dev/Carl/KinetiText/src/core/services/AudioConvertGoWrapper.ts` — Bun IPC wrapper pattern verified
- `/Users/carl/Dev/Carl/KinetiText/src/core/services/DurationGoWrapper.ts` — Bun IPC wrapper (second example) verified
- `/Users/carl/Dev/Carl/KinetiText/src/config/DurationGoConfig.ts` — Config pattern verified
- `/Users/carl/Dev/Carl/KinetiText/.planning/phases/06-audio-convert-go/06-03-SUMMARY.md` — Phase 6 outcomes verified
- `/Users/carl/Dev/Carl/KinetiText/.planning/phases/07-durationservice/07-02-SUMMARY.md` — Phase 7 outcomes verified
- `/Users/carl/Dev/Carl/kinetitext-go/Makefile` — Build target patterns verified
- `command -v go && go version` — Go 1.25.5 confirmed available
- `command -v ffmpeg && ffmpeg -version` — FFmpeg 8.0.1 confirmed available

### Secondary (MEDIUM confidence)

- `docs/ARCHITECTURE.md` — IPC protocol design and performance benchmarks from Phase 6
- `docs/MIGRATION_GUIDE.md` — Environment variable naming conventions and 4-mode activation pattern
- `src/tests/e2e/MP4Conversion.e2e.ts` — Existing Bun test patterns that Go E2E should mirror
- `src/tests/e2e/AudioConvertGo.e2e.ts` (referenced in summaries) — Graceful degradation test pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified all existing libraries in go.mod and package.json
- Architecture: HIGH — two prior phases have proven the exact patterns being reused
- Pitfalls: MEDIUM-HIGH — based on Phase 6 post-execution lessons + code analysis; ffmpeg-go metadata flag syntax remains unverified until a test is written
- Performance targets: MEDIUM — extrapolated from Phase 6 data; actual AAC encoder performance may differ from MP3

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stable domain; ffmpeg-go v0.5.0 is unlikely to change)
