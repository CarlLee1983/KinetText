# MP4 Go Backend Developer Guide

**Phase**: 8 (MP4ConversionService Go Migration)
**Version**: 1.0
**Last Updated**: 2026-03-26
**Status**: Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start (4 Methods)](#quick-start-4-methods)
3. [Configuration Options](#configuration-options)
4. [Performance Comparison](#performance-comparison)
5. [Troubleshooting](#troubleshooting)
6. [Developer Guide](#developer-guide)
7. [FAQ](#faq)
8. [Next Steps](#next-steps)

---

## Overview

Phase 8 introduces an optional Go backend for MP3→M4A (AAC audio) conversion, complementing the existing Bun FFmpeg implementation. This guide helps developers understand, configure, and extend the MP4 Go backend.

### What Changed

**Before (Bun only)**:
```typescript
const service = new MP4ConversionService(config, retryService, errorClassifier)
const result = await service.convert(inputMp3, outputM4a, metadata)
// Uses: Bun subprocess + FFmpeg
```

**Now (Optional Go backend)**:
```typescript
const goConfig: MP4ConvertGoConfig = {
  enabled: true,
  goBinaryPath: '../kinetitext-go/bin/kinetitext-mp4convert',
  timeout: 60000
}
const service = new MP4ConversionService(config, retryService, errorClassifier, goConfig)
await service.initGoBackend()  // Optional, lazy initialization
const result = await service.convert(inputMp3, outputM4a, metadata)
// Uses: Go subprocess + FFmpeg (if available), fallback to Bun
```

### Key Features

✅ **Backward Compatible**: Existing code works unchanged (Go backend optional)
✅ **Graceful Degradation**: Go binary unavailable → automatic fallback to Bun
✅ **Metadata Support**: All 7 fields (title, artist, album, date, genre, trackNumber, comment)
✅ **UTF-8 Native**: Chinese/multilingual metadata supported natively
✅ **Performance**: 20-30% improvement for audiobook chapters (>30s)

---

## Quick Start (4 Methods)

### Method 1: Environment Variables

Simplest for development and system-wide configuration.

```bash
# Enable Go backend via environment variable
export MP4_GO_ENABLED=true
export MP4_GO_BINARY_PATH=../kinetitext-go/bin/kinetitext-mp4convert
export MP4_GO_TIMEOUT_MS=60000

# Run your crawler
bun run src/index.ts --crawl https://example.com
```

**Verification**:
```bash
# Check logs for "Go backend initialized successfully"
# Or time the conversion (Go should be ~20-30% faster)
```

### Method 2: .env File

Recommended for project setup, tracked in git (without secrets).

```env
# .env (at project root)
MP4_GO_ENABLED=true
MP4_GO_BINARY_PATH=../kinetitext-go/bin/kinetitext-mp4convert
MP4_GO_TIMEOUT_MS=120000
```

**How it works**:
- Bun automatically loads `.env` at startup
- No code changes needed
- Environment variables take precedence over .env values

### Method 3: CLI Flag

For one-off runs or CI/CD pipelines.

```bash
bun run src/index.ts \
  --use-go-mp4 \
  --go-mp4-binary-path=../kinetitext-go/bin/kinetitext-mp4convert \
  --go-mp4-timeout=120000 \
  --crawl https://example.com
```

**How it works**:
- CrawlerEngine CLI parser recognizes Go-specific flags
- Overrides environment variable settings
- Useful for testing different configurations

### Method 4: Code Configuration

For programmatic control (recommended for library users).

```typescript
import { CrawlerEngine } from './src/core/CrawlerEngine'
import { MP4ConversionService } from './src/core/services/MP4ConversionService'
import { MP4ConvertGoConfig } from './src/config/MP4ConvertGoConfig'

const goConfig: MP4ConvertGoConfig = {
  enabled: true,
  goBinaryPath: '../kinetitext-go/bin/kinetitext-mp4convert',
  timeout: 120000  // 2 minutes for long chapters
}

const engine = new CrawlerEngine({
  crawlUrl: 'https://example.com',
  mp4GoConfig: goConfig  // Pass to engine constructor
})

await engine.crawl()
```

**How it works**:
- Explicit configuration passed to services
- Type-safe (TypeScript validates config shape)
- Best for reusable library integration

---

## Configuration Options

### Environment Variables

| Variable | Type | Default | Valid Range | Description |
|---|---|---|---|---|
| `MP4_GO_ENABLED` | `boolean` | `false` | `true` \| `false` | Enable Go backend for MP4 conversion |
| `MP4_GO_BINARY_PATH` | `string` | auto-detect | Filesystem path | Absolute or relative path to `kinetitext-mp4convert` binary |
| `MP4_GO_TIMEOUT_MS` | `number` | `60000` | `1000-300000` | Conversion timeout in milliseconds (1s to 5m) |

### Type Definition: MP4ConvertGoConfig

```typescript
export interface MP4ConvertGoConfig {
  /**
   * Enable or disable Go backend delegation
   * When false, all conversions use Bun FFmpeg
   * @default false
   */
  enabled: boolean

  /**
   * Absolute or relative path to kinetitext-mp4convert binary
   * Relative paths resolved from project root
   * @default '../kinetitext-go/bin/kinetitext-mp4convert'
   */
  goBinaryPath: string

  /**
   * Timeout for Go subprocess conversion in milliseconds
   * Single conversion must complete within this time
   * @default 60000 (60 seconds)
   * @min 1000 (1 second)
   * @max 300000 (5 minutes)
   */
  timeout: number
}
```

### MP4ConversionConfig (Unchanged)

Configuration for conversion parameters (applies to both Bun and Go backends):

```typescript
export interface MP4ConversionConfig {
  bitrate: number              // 96-320 kbps (default: 256)
  outputFormat: 'm4a' | 'mp4'  // Output container (m4a for audio)
  videoBackground: string      // 'none' | 'color' | 'image'
  videoWidth: number           // 1920
  videoHeight: number          // 1080
  maxConcurrency: number       // 1-8 (default: 2)
  outputDirectory: string      // Where to save outputs
  retryMaxAttempts: number     // 2-5 (default: 3)
}
```

### Metadata Fields (All Optional)

```typescript
export interface MP4Metadata {
  title?: string              // Chapter or book title (max 100 chars)
  artist?: string             // Author name (max 100 chars)
  album?: string              // Book name (max 100 chars)
  date?: string               // Publication date (YYYY-MM-DD format)
  genre?: string              // Category (e.g., "Audiobook", "Fiction")
  trackNumber?: number        // Chapter number (1-999)
  comment?: string            // Additional metadata (max 500 chars)
}
```

**Example with metadata**:
```typescript
const metadata: MP4Metadata = {
  title: 'Chapter 5: The Quest Begins',
  artist: '林念慈',  // UTF-8 Chinese name supported
  album: '魔戒: 魔戒同盟',
  date: '2026-03-26',
  genre: 'Fantasy Audiobook',
  trackNumber: 5,
  comment: 'Narrated by Morgan Freeman'
}

await service.convert(inputMp3, outputM4a, metadata)
```

---

## Performance Comparison

### Benchmarks from Phase 8 Testing

| Duration | Bun FFmpeg | Go Backend | Speedup | Notes |
|---|---|---|---|---|
| 5 seconds | 120ms | 135ms | -13% ⚠️ | Startup overhead > conversion time |
| 10 seconds | 145ms | 140ms | +3% | Near parity |
| 30 seconds | 310ms | 265ms | **+15%** ✅ | Go advantage begins |
| 1 minute | 570ms | 460ms | **+19%** ✅ | Typical short chapter |
| 5 minutes | 2.8s | 1.95s | **+30%** ✅ | Typical long chapter |

### Decision Tree: When to Enable Go Backend

```
Is your typical chapter duration > 30 seconds?
  ├─ YES → Enable Go backend (MP4_GO_ENABLED=true)
  │         Expected 15-30% faster processing
  │         Perfect for audiobook crawlers
  │
  └─ NO → Keep Bun only (MP4_GO_ENABLED=false, default)
          Minimal difference in speed
          Simpler deployment (no Go binary needed)
```

### Real-World Example: Audiobook Crawler

**Scenario**: Crawling 200 chapters, 30 minutes each

```
Bun only:  200 × 570ms = 114 seconds
Go backend: 200 × 460ms = 92 seconds
                          ↓
                    Saves 22 seconds (19% faster!)
```

**Multiplied over 1000+ chapters**: 2-4 minutes saved per book.

---

## Troubleshooting

### Issue 1: "MP4_GO_ENABLED=true but Go backend not used"

**Symptom**: Environment variable set, but logs show "回退至 Bun FFmpeg" (falling back to Bun).

**Diagnosis**:
1. Check if binary exists and is executable:
   ```bash
   ls -la ../kinetitext-go/bin/kinetitext-mp4convert
   # Should output: -rwxr-xr-x (executable)

   file ../kinetitext-go/bin/kinetitext-mp4convert
   # Should output: Mach-O 64-bit executable arm64 (macOS)
   ```

2. Verify binary compatibility:
   ```bash
   ../kinetitext-go/bin/kinetitext-mp4convert --version
   # Should output version or accept --help
   ```

3. Check logs for specific error:
   ```bash
   grep -i "二進制" application.log
   # Look for "MP4 Go 二進制不可用" with specific path
   ```

**Solutions**:
- **Wrong path**: Update `MP4_GO_BINARY_PATH` to correct location
- **Binary missing**: Rebuild: `cd kinetitext-go && make build-mp4convert`
- **Wrong architecture**: Recompile for your system: `GOOS=darwin GOARCH=arm64 go build`

---

### Issue 2: "Go backend fails, fallback to Bun works"

**Symptom**: Conversion succeeds but slower (using Bun fallback).

**Root causes**:
1. Binary path invalid (see Issue 1)
2. Go runtime error (FFmpeg not installed on Go system)
3. Permission denied (binary not executable)
4. Timeout exceeded (file larger than timeout allows)

**Diagnosis**:
```bash
# Test Go binary in isolation
echo '{"input_file":"test.mp3","output_file":"out.m4a","bitrate":256}' | \
  ../kinetitext-go/bin/kinetitext-mp4convert

# Should return JSON: {"success":true,"output_file":"out.m4a"}
# If error: {"success":false,"error":"..."}
```

**Solutions**:
- **Permission**: `chmod +x ../kinetitext-go/bin/kinetitext-mp4convert`
- **FFmpeg missing on Go system**: Install: `brew install ffmpeg`
- **Timeout**: Increase `MP4_GO_TIMEOUT_MS` (e.g., `300000` for 5m)

---

### Issue 3: "Metadata not embedded in M4A file"

**Symptom**: Conversion succeeds, but ffprobe shows no metadata.

**Diagnosis**:
```bash
# Verify metadata was passed to service
console.log('Metadata:', metadata)  // Add to code before convert()

# Check M4A file with ffprobe
ffprobe -show_format output.m4a | grep TAG
# Should show tags like TAG:title, TAG:artist, etc.
```

**Solutions**:
- **Metadata not provided**: Pass metadata object:
  ```typescript
  const metadata: MP4Metadata = { title: 'Chapter 1' }
  await service.convert(input, output, metadata)
  ```

- **Metadata field nil**: Check for undefined fields:
  ```typescript
  if (metadata.title === undefined) {
    console.warn('Title not provided')
  }
  ```

- **FFmpeg not embedding**: Verify command-line args generated correctly (check logs)

---

### Issue 4: "Timeout during conversion"

**Symptom**: Error message: "Go subprocess timeout after Xms"

**Root cause**: Audio file larger than timeout allows.

**Calculation**:
```
Estimated conversion time = file_duration × 0.5-1.0
Example: 60-minute chapter × 0.7 = 42 seconds conversion time
Minimum timeout needed: 42,000 ms (42 seconds)
```

**Solutions**:
- **Increase timeout** for specific scenario:
  ```bash
  export MP4_GO_TIMEOUT_MS=180000  # 3 minutes
  ```

- **Disable Go backend** for very long files:
  ```typescript
  const goConfig = {
    enabled: audioFile.duration < 3600,  // Disable for >1 hour
    goBinaryPath: '...',
    timeout: 120000
  }
  ```

---

### Issue 5: "UTF-8 metadata corrupted (Chinese characters)"

**Symptom**: ffprobe shows garbled characters instead of Chinese.

**Diagnosis**:
```bash
# Check terminal encoding
echo $LANG
# Should show: en_US.UTF-8 or zh_TW.UTF-8

# Verify file encoding
file -i output.m4a
# Should show: audio/x-m4a; charset=utf-8
```

**Solutions**:
- **Terminal encoding**: Set environment:
  ```bash
  export LANG=en_US.UTF-8
  ```

- **Input string validation**: Ensure metadata is valid UTF-8:
  ```typescript
  const title = '測試'
  console.assert(/^[\p{L}\p{N}\s]+$/u.test(title), 'Invalid UTF-8')
  ```

- **Go binary Unicode**: Verify with test:
  ```bash
  echo '{"input_file":"test.mp3","output_file":"out.m4a","bitrate":256,"metadata":{"title":"測試"}}' | \
    ../kinetitext-go/bin/kinetitext-mp4convert
  ```

---

### Issue 6: "Binary not found on different system"

**Symptom**: Works on macOS but fails on Linux.

**Root cause**: Binary compiled for different OS.

**Solutions**:
- **Recompile for target system**:
  ```bash
  cd ../kinetitext-go
  make build-mp4convert GOOS=linux GOARCH=amd64
  # Output: bin/kinetitext-mp4convert-linux-amd64
  ```

- **Use absolute path**:
  ```bash
  export MP4_GO_BINARY_PATH=/opt/kinetitext-go/bin/kinetitext-mp4convert
  ```

- **Check system compatibility**:
  ```bash
  uname -m  # arm64 vs x86_64 vs aarch64
  uname -s  # Darwin (macOS) vs Linux
  ```

---

### Issue 7: "Performance worse than expected"

**Symptom**: Go backend only 5-10% faster, not 20-30%.

**Diagnosis**:
1. Verify Go backend actually enabled:
   ```typescript
   // Add to code temporarily
   console.log('goBackendInitialized:', true)  // Check logs
   ```

2. Check system load:
   ```bash
   top -bn 1 | head -n 5
   # High CPU% or load average suggests CPU bottleneck (expected for FFmpeg)
   ```

3. Review file size:
   ```bash
   ls -lh input.mp3 output.m4a
   # Compare with benchmark files (5s, 30s, 1m, 5m test durations)
   ```

**Solutions**:
- **Small test files**: Use 30-second+ files to see Go advantage
- **System overload**: Close other apps, check CPU/memory
- **Concurrent conversions**: Go shine is cumulative; test with 10+ files
- **Expected behavior**: 5-10 second files show minimal improvement (see benchmark)

---

## Developer Guide

### Modifying Go Code

The Go backend lives in the sibling `kinetitext-go` project.

#### Step 1: Edit Go Source

```bash
cd ../kinetitext-go
vi src/mp4-convert/converter.go
```

Key files:
- `src/mp4-convert/types.go` — Data structures (MP4ConvertRequest, MP4Metadata)
- `src/mp4-convert/converter.go` — Core logic (ConvertMP4, buildMetadataArgs)
- `src/mp4-convert/main.go` — Entry point (stdin/stdout JSON handling)
- `src/mp4-convert/converter_test.go` — Unit tests

#### Step 2: Run Go Tests

```bash
cd src/mp4-convert
go test -v

# Example output:
# === RUN   TestBuildM4AKwArgs_DefaultBitrate
# --- PASS: TestBuildM4AKwArgs_DefaultBitrate (0.00s)
# === RUN   TestBuildMetadataArgs_UTF8
# --- PASS: TestBuildMetadataArgs_UTF8 (0.00s)
# OK  github.com/kinetitext/mp4-convert
```

#### Step 3: Recompile Binary

```bash
cd ../..  # Back to kinetitext-go root
make build-mp4convert

# Output should show:
# go build -o bin/kinetitext-mp4convert ./src/mp4-convert
```

#### Step 4: Test Bun Integration

```bash
cd ../../KinetiText  # Back to main project
bun test ./src/tests/integration/MP4ConvertGo.test.ts --bail

# Should see: "11 pass"
```

#### Step 5: Update Bun Types (if needed)

If you add new metadata fields or request parameters:

```typescript
// src/core/services/MP4ConvertGoWrapper.ts
export interface MP4ConvertGoRequest {
  input_file: string
  output_file: string
  bitrate: number
  metadata?: {
    title?: string
    artist?: string
    album?: string
    date?: string
    genre?: string
    track_number?: number
    comment?: string
  }
}
```

### Adding New Metadata Fields

**Example**: Add "language" field to metadata.

#### 1. Go Side (kinetitext-go)

```go
// src/mp4-convert/types.go
type MP4MetadataGo struct {
  Title       string `json:"title,omitempty"`
  Artist      string `json:"artist,omitempty"`
  Album       string `json:"album,omitempty"`
  Date        string `json:"date,omitempty"`
  Genre       string `json:"genre,omitempty"`
  TrackNumber int    `json:"track_number,omitempty"`
  Comment     string `json:"comment,omitempty"`
  Language    string `json:"language,omitempty"`  // NEW
}

// src/mp4-convert/converter.go
func buildMetadataArgs(metadata *MP4MetadataGo) []string {
  if metadata.Language != "" {
    args = append(args, "-metadata", fmt.Sprintf("language=%s", metadata.Language))
  }
  // ... existing fields
}
```

#### 2. Bun Side

```typescript
// src/core/types/audio.ts
export interface MP4Metadata {
  title?: string
  artist?: string
  album?: string
  date?: string
  genre?: string
  trackNumber?: number
  comment?: string
  language?: string  // NEW
}

// src/core/services/MP4ConvertGoWrapper.ts
// Map Bun camelCase to Go snake_case
const req: MP4ConvertGoRequest = {
  ...existing fields...,
  metadata: {
    ...existing metadata...,
    language: metadata.language  // Add field mapping
  }
}
```

#### 3. Tests

```typescript
// Add test for new field
test('handles language metadata', async () => {
  const metadata: MP4Metadata = {
    title: 'Chapter 1',
    language: 'en-US'  // NEW
  }

  await service.convert(input, output, metadata)

  const ffprobeOutput = await parseFile(output)
  // Verify language tag is present
  expect(ffprobeOutput.common?.language).toBeDefined()
})
```

### Testing Go Code in Isolation

You can test the Go binary directly without Bun:

```bash
# Test basic conversion
echo '{
  "input_file":"/tmp/test.mp3",
  "output_file":"/tmp/out.m4a",
  "bitrate":256
}' | ../kinetitext-go/bin/kinetitext-mp4convert

# Test with metadata
echo '{
  "input_file":"/tmp/test.mp3",
  "output_file":"/tmp/out.m4a",
  "bitrate":256,
  "metadata":{
    "title":"Test",
    "artist":"Author",
    "album":"Book"
  }
}' | ../kinetitext-go/bin/kinetitext-mp4convert

# Expected output:
# {"success":true,"output_file":"/tmp/out.m4a"}
#
# Or on error:
# {"success":false,"error":"FFmpeg error: ..."}
```

### Debugging Integration Issues

Enable detailed logging in Bun:

```typescript
// src/core/utils/logger.ts
const logger = getLogger('MP4ConvertGoWrapper')

// During conversion
logger.debug({ request }, 'Sending to Go backend')
logger.debug({ response }, 'Received from Go backend')
```

Review logs:
```bash
grep -i "mp4convert" application.log | jq '.'
# Will show JSON logs with request/response details
```

---

## FAQ

### Q: Will Go backend become mandatory?

**A**: No. Bun FFmpeg will remain as fallback. Go backend is always optional (default: disabled).

---

### Q: Can I switch between Bun and Go at runtime?

**A**: No. Go backend must be initialized once at startup via `initGoBackend()`. For runtime switching, create separate service instances:

```typescript
const bunService = new MP4ConversionService(config, retry, classifier)
const goService = new MP4ConversionService(config, retry, classifier, goConfig)
await goService.initGoBackend()

// Use goService for long files, bunService for short
```

---

### Q: Is metadata embedding mandatory?

**A**: No. Metadata is fully optional:

```typescript
// Works without metadata
await service.convert(input, output)  // Empty metadata
await service.convert(input, output, {})  // Explicit empty
await service.convert(input, output, { title: 'Chapter 1' })  // Partial metadata
```

---

### Q: What if kinetitext-go repository is not available?

**A**: Go backend gracefully disables. Service logs warning and continues with Bun FFmpeg. Zero service interruption.

---

### Q: How do I know if Go backend is active?

**A**: Check logs for "Go backend initialized successfully":

```bash
grep "Go backend initialized successfully" logs.json | jq .
```

Or time conversions:
```bash
# Time Bun: ~570ms for 1-minute file
# Time Go: ~460ms for 1-minute file
# If Go is 20-30% faster, backend is active
```

---

### Q: Is there performance cost for metadata?

**A**: Minimal. Metadata embedding adds ~1-2ms regardless of backend. No significant impact on conversion time.

---

### Q: Can I use Go backend on Windows?

**A**: Yes, but requires subprocess JSON IPC (not Bun FFI). Windows support planned for Milestone 3.

Current status: macOS/Linux only (FFI works on these platforms).

---

### Q: What's next after Phase 8?

**A**: Phase 9 (Milestone 3, planned):
- ContentCleaner Go migration (if ROI sufficient)
- Persistent daemon mode (eliminate 50-80ms startup overhead)
- Direct Bun FFI binding (replace subprocess JSON IPC, gain ~1-2ms)
- Windows binary distribution

See ROADMAP.md for full timeline.

---

## Next Steps

### For Developers

1. ✅ Review ARCHITECTURE.md (Chapter 6: Bun-Go hybrid design)
2. ✅ Read PERF_REPORT.md (performance baseline and rationale)
3. ✅ Run E2E tests: `bun test ./src/tests/e2e/MP4ConvertGo.e2e.ts`
4. ✅ Explore Go code: `cd ../kinetitext-go/src/mp4-convert`

### For Integrators

1. Enable Go backend in production:
   ```bash
   export MP4_GO_ENABLED=true
   export MP4_GO_BINARY_PATH=../kinetitext-go/bin/kinetitext-mp4convert
   ```

2. Increase timeout for long chapters (>60 min):
   ```bash
   export MP4_GO_TIMEOUT_MS=300000  # 5 minutes
   ```

3. Monitor conversion speeds and adjust concurrency as needed.

### For Researchers

- Phase 8 PERF_REPORT.md contains detailed performance analysis
- Phase 6 MIGRATION_GUIDE.md shows audio conversion patterns
- Phase 7 DURATION_SERVICE.md demonstrates Go backend patterns

---

## Support & Resources

- **Phase 8 Summary**: `.planning/phases/08-mp4conversionservice-go/08-02-SUMMARY.md`
- **ARCHITECTURE.md**: System design and Bun-Go boundary
- **PERF_REPORT.md**: Performance benchmarks and root cause analysis
- **Integration Tests**: `src/tests/integration/MP4ConvertGo.test.ts`
- **E2E Tests**: `src/tests/e2e/MP4ConvertGo.e2e.ts`

---

**Document Version**: 1.0
**Status**: Production Ready
**Maintained by**: Development Team
**Last Updated**: 2026-03-26
