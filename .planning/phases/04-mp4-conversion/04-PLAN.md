---
phase: 04-mp4-conversion
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/types/audio.ts
  - src/core/config/MP4ConversionConfig.ts
  - src/core/services/MP4ConversionService.ts
  - src/core/utils/ffmpeg-commands.ts
  - src/tests/unit/MP4ConversionService.test.ts
autonomous: true
requirements:
  - R1.3.1
  - R1.3.2

must_haves:
  truths:
    - "MP3 files are converted to M4A (AAC codec) format successfully"
    - "Metadata (title, artist, album) is correctly embedded in M4A files"
    - "Concurrent conversions respect p-limit to avoid system overload"
    - "Conversion errors are classified and handled with RetryService"
    - "M4A files are readable by music-metadata and standard players"
    - "Configuration schema supports bitrate, metadata, and concurrency control"
  artifacts:
    - path: "src/core/config/MP4ConversionConfig.ts"
      provides: "MP4ConversionConfig interface and configuration schema"
      exports: ["MP4ConversionConfig", "loadMP4Config"]
    - path: "src/core/types/audio.ts"
      provides: "MP4ConversionResult and MP4Metadata interfaces"
      contains: "MP4Metadata"
    - path: "src/core/services/MP4ConversionService.ts"
      provides: "MP4ConversionService class with convert() and convertBatch()"
      exports: ["MP4ConversionService"]
    - path: "src/core/utils/ffmpeg-commands.ts"
      provides: "FFmpeg command builders for M4A conversion with metadata"
      exports: ["buildM4ACommand", "buildMP4WithVideoCommand"]
    - path: "src/tests/unit/MP4ConversionService.test.ts"
      provides: "Unit tests for conversion logic and error classification"
      min_lines: 200
  key_links:
    - from: "src/core/services/MP4ConversionService.ts"
      to: "src/core/config/MP4ConversionConfig.ts"
      via: "loads configuration for bitrate, metadata, concurrency"
      pattern: "loadMP4Config|MP4ConversionConfig"
    - from: "src/core/services/MP4ConversionService.ts"
      to: "src/core/services/RetryService.ts"
      via: "wraps conversions with retry logic for transient errors"
      pattern: "retryService\\.executeWithRetry"
    - from: "src/core/services/MP4ConversionService.ts"
      to: "src/core/services/AudioErrorClassifier.ts"
      via: "classifies FFmpeg errors (transient vs permanent)"
      pattern: "audioErrorClassifier"
    - from: "src/core/utils/ffmpeg-commands.ts"
      to: "Bun.$"
      via: "executes FFmpeg subprocesses for M4A conversion"
      pattern: "\\$`ffmpeg|bash"

---

<objective>
Implement MP3→M4A conversion service with metadata embedding, configuration management, and error handling integration.

Purpose: Complete R1.3.1 (MP3→MP4 conversion with optional video) and R1.3.2 (metadata embedding). M4A (audio-only MP4 with AAC codec) is the standard format for audiobooks; Phase 04-01 establishes the core conversion engine and config schemas. Phase 04-02 adds end-to-end pipeline integration and CLI wiring.

Output: `MP4ConversionService` with `convert()` and `convertBatch()` methods, `MP4ConversionConfig` interface, FFmpeg command builders, unit tests covering conversion, metadata, error classification, and concurrent batch operations.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/04-mp4-conversion/04-RESEARCH.md
@.planning/STATE.md

@src/core/services/RetryService.ts
@src/core/services/AudioErrorClassifier.ts
@src/core/types/audio.ts
@src/core/config/AudioConvertConfig.ts

<interfaces>
<!-- Existing interfaces the executor needs -->

From src/core/services/RetryService.ts:
```typescript
export interface RetryOptions {
  maxAttempts: number
  backoff: 'linear' | 'exponential'
  initialDelay?: number
  maxDelay?: number
  classifier?: ErrorClassifier
}

export class RetryService {
  executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions
  ): Promise<T>
}
```

From src/core/services/AudioErrorClassifier.ts:
```typescript
export interface ErrorClassification {
  readonly isTransient: boolean
  readonly reason: string
}

export class AudioErrorClassifier {
  classify(error: Error): ErrorClassification
}
```

From src/core/types/audio.ts:
```typescript
export interface AudioFormat {
  readonly format: string
  readonly codec: string
  readonly bitrate: number
  readonly duration: number
}
```
</interfaces>

</context>

<tasks>

<task type="auto">
  <name>Task 1: Create MP4ConversionConfig schema with validation</name>
  <files>src/core/config/MP4ConversionConfig.ts</files>
  <action>
Create MP4ConversionConfig interface and loadMP4Config() function supporting:
  - bitrate: number (default 256 kbps for AAC; range 96-320 kbps)
  - outputFormat: 'm4a' | 'mp4' (default 'm4a' for audio-only)
  - videoBackground: 'none' | 'black' | 'image' (default 'none')
  - videoWidth: number (default 1920, used if videoBackground !== 'none')
  - videoHeight: number (default 1080, used if videoBackground !== 'none')
  - maxConcurrency: number (default 2, range 1-8; prevents system overload)
  - outputDirectory: string (required; creates if missing)
  - retryMaxAttempts: number (default 3; integration with Phase 1 RetryService)

Use Zod for schema validation (consistent with Phase 2 AudioConvertConfig pattern). Load from:
  1. Environment variables (MP4_BITRATE, MP4_MAX_CONCURRENCY, etc.)
  2. .env file (Bun auto-loads)
  3. Defaults as fallback

Include comprehensive error messages for invalid values (e.g., "bitrate must be 96-320 kbps, got 500").

Export interface:
```typescript
export interface MP4ConversionConfig {
  readonly bitrate: number
  readonly outputFormat: 'm4a' | 'mp4'
  readonly videoBackground: 'none' | 'black' | 'image'
  readonly videoWidth: number
  readonly videoHeight: number
  readonly maxConcurrency: number
  readonly outputDirectory: string
  readonly retryMaxAttempts: number
}

export function loadMP4Config(): Promise<MP4ConversionConfig>
```

Per design decision D-01 (use M4A format), default outputFormat to 'm4a'.
  </action>
  <verify>
    <automated>bun test src/tests/unit/MP4ConversionConfig.test.ts -t "schema" 2>&1 | grep -E "pass|fail"</automated>
  </verify>
  <done>MP4ConversionConfig.ts exports interface and loadMP4Config(); validates bitrate range, concurrency limits, output directory creation; environment variable + .env loading works; Zod schema validates all fields</done>
</task>

<task type="auto">
  <name>Task 2: Add MP4Metadata and MP4ConversionResult types to audio.ts</name>
  <files>src/core/types/audio.ts</files>
  <action>
Extend src/core/types/audio.ts with new types:

```typescript
export interface MP4Metadata {
  readonly title?: string
  readonly artist?: string
  readonly album?: string
  readonly date?: string
  readonly genre?: string
  readonly trackNumber?: number
  readonly comment?: string
}

export interface MP4ConversionResult {
  readonly inputPath: string
  readonly outputPath: string
  readonly format: 'M4A' | 'MP4'
  readonly duration: number
  readonly bitrate: number
  readonly fileSize: number
  readonly metadata: Readonly<MP4Metadata>
  readonly timestamp: number
  readonly error?: string
}
```

All types use readonly for immutability (per CLAUDE.md rule). MP4Metadata fields are optional (some files may lack full metadata). MP4ConversionResult.error is only set on failure.

Export both types for use in MP4ConversionService and tests.
  </action>
  <verify>
    <automated>grep -n "export interface MP4Metadata" src/core/types/audio.ts && grep -n "export interface MP4ConversionResult" src/core/types/audio.ts</automated>
  </verify>
  <done>audio.ts contains both MP4Metadata and MP4ConversionResult types with readonly fields and proper optional annotations; types are exported and ready for service implementation</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Build FFmpeg command helpers in ffmpeg-commands.ts</name>
  <files>src/core/utils/ffmpeg-commands.ts</files>
  <behavior>
    - buildM4ACommand() returns safe FFmpeg command array (not shell string) for MP3→M4A conversion with metadata
    - buildM4ACommand() escapes metadata strings to prevent shell injection
    - buildMP4WithVideoCommand() constructs command for M4A with black video background using color filter
    - buildMP4WithVideoCommand() includes -shortest flag to sync video duration with audio
    - Commands use parameterized format (array of args) compatible with Bun.$ execution
    - Metadata fields (title, artist) with special characters (quotes, newlines) are properly escaped
  </behavior>
  <action>
Create src/core/utils/ffmpeg-commands.ts with two command builders:

1. **buildM4ACommand()**
   - Input: inputPath (string), outputPath (string), bitrate (number), metadata? (MP4Metadata)
   - Output: string[] of FFmpeg arguments (not shell string)
   - Pattern:
     ```
     ffmpeg -y -i {input} -c:a aac -b:a {bitrate}k
       -metadata title="{escaped_title}" ... {output}
     ```
   - Validate bitrate (96-320 kbps)
   - Escape metadata using JSON.stringify to avoid shell injection
   - Include -y flag to overwrite without prompt

2. **buildMP4WithVideoCommand()** (optional, Phase 04-02 may use)
   - Input: audioPath, outputPath, bitrate, width, height, metadata?
   - Output: string[] of FFmpeg arguments
   - Pattern:
     ```
     ffmpeg -f lavfi -i color=c=black:s={width}x{height}
       -i {audio} -c:v libx264 -preset fast -c:a aac
       -map 0 -map 1 -shortest {metadata_flags} {output}
     ```
   - Include -shortest to prevent video truncation
   - H.264 preset 'fast' balances quality and speed

Both functions return string[] (command args), NOT shell strings. Executor will use with Bun.$:
```typescript
const cmd = buildM4ACommand(...)
await $`ffmpeg ${cmd}`.quiet()
```

Per research, avoid `-c:a copy` (MP3 in MP4 not standard); use `-c:a aac` for transcoding.
  </action>
  <verify>
    <automated>bun test src/tests/unit/FFmpegCommands.test.ts -t "M4A command" 2>&1 | grep -E "pass|fail"</automated>
  </verify>
  <done>ffmpeg-commands.ts exports buildM4ACommand() and buildMP4WithVideoCommand(); commands are parameterized as string[], metadata escaping prevents injection, bitrate validation included, -shortest flag present in video command</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Implement MP4ConversionService with convert() and convertBatch()</name>
  <files>src/core/services/MP4ConversionService.ts</files>
  <behavior>
    - convert() accepts inputPath, outputPath, metadata, uses buildM4ACommand() to create FFmpeg args
    - convert() executes FFmpeg via Bun.$ subprocess, captures exit code and stderr
    - convert() wraps execution with RetryService.executeWithRetry() using AudioErrorClassifier
    - convertBatch() accepts array of {inputPath, outputPath, metadata}, limits concurrency via p-limit
    - convertBatch() returns array of MP4ConversionResult with success/error status
    - All conversions verify output file size > 0 before marking success
    - Service injects RetryService and AudioErrorClassifier in constructor (DI)
    - Logging via Pino structured logger (per Phase 2 pattern)
    - All errors are classified (transient vs permanent) per AudioErrorClassifier
  </behavior>
  <action>
Create src/core/services/MP4ConversionService.ts:

```typescript
import { Readable } from 'stream'
import pLimit from 'p-limit'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { MP4ConversionConfig } from '../config/MP4ConversionConfig'
import { MP4ConversionResult, MP4Metadata } from '../types/audio'
import { buildM4ACommand, buildMP4WithVideoCommand } from '../utils/ffmpeg-commands'
import { getLogger } from '../utils/logger' // Pino logger from Phase 2

export interface ConvertOptions {
  readonly inputPath: string
  readonly outputPath: string
  readonly metadata?: Readonly<MP4Metadata>
}

export class MP4ConversionService {
  constructor(
    private readonly config: MP4ConversionConfig,
    private readonly retryService: RetryService,
    private readonly errorClassifier: AudioErrorClassifier
  ) {
    this.logger = getLogger('MP4ConversionService')
  }

  private readonly logger: any

  async convert(
    inputPath: string,
    outputPath: string,
    metadata?: Readonly<MP4Metadata>
  ): Promise<MP4ConversionResult> {
    // Validate input file exists
    const inputFile = Bun.file(inputPath)
    if (!(await inputFile.exists())) {
      throw new Error(`Input file not found: ${inputPath}`)
    }

    // Build FFmpeg command
    const ffmpegArgs = buildM4ACommand(
      inputPath,
      outputPath,
      this.config.bitrate,
      metadata
    )

    // Execute with retry
    const result = await this.retryService.executeWithRetry(
      async () => {
        this.logger.debug({ ffmpegArgs, inputPath }, 'Starting MP4 conversion')

        const cmd = `ffmpeg ${ffmpegArgs.map(arg =>
          arg.includes(' ') ? `"${arg}"` : arg
        ).join(' ')}`

        const process = await $`bash -c ${cmd}`.quiet()

        if (process.exitCode !== 0) {
          const stderr = process.stderr?.toString() ?? ''
          throw new Error(`FFmpeg failed: ${stderr}`)
        }
      },
      {
        maxAttempts: this.config.retryMaxAttempts,
        backoff: 'exponential',
        classifier: this.errorClassifier
      }
    )

    // Verify output
    const outputFile = Bun.file(outputPath)
    const stats = await outputFile.size ? outputFile : null
    if (!stats || stats === 0) {
      throw new Error(`Output file empty or missing: ${outputPath}`)
    }

    // Parse duration and bitrate from output (via music-metadata in Phase 04-02)
    // For now, return placeholder
    return {
      inputPath,
      outputPath,
      format: 'M4A',
      duration: 0, // TODO: parse from music-metadata
      bitrate: this.config.bitrate,
      fileSize: stats,
      metadata: metadata ?? {},
      timestamp: Date.now()
    }
  }

  async convertBatch(
    options: ReadonlyArray<ConvertOptions>
  ): Promise<ReadonlyArray<MP4ConversionResult>> {
    const limiter = pLimit(this.config.maxConcurrency)

    const results = await Promise.all(
      options.map(opt =>
        limiter(async () => {
          try {
            return await this.convert(
              opt.inputPath,
              opt.outputPath,
              opt.metadata
            )
          } catch (error) {
            this.logger.error(
              { error, input: opt.inputPath },
              'Conversion failed'
            )
            return {
              inputPath: opt.inputPath,
              outputPath: opt.outputPath,
              format: 'M4A',
              duration: 0,
              bitrate: this.config.bitrate,
              fileSize: 0,
              metadata: opt.metadata ?? {},
              timestamp: Date.now(),
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          }
        })
      )
    )

    return results
  }
}
```

Key design decisions:
- Uses Bun.file() to check input exists (no Node.js fs)
- Executes FFmpeg via Bun.$ with bash -c for complex command
- Wraps execution with RetryService for transient error recovery
- Validates output file size > 0 before success
- Logs via Pino (logger from Phase 2)
- convertBatch() uses p-limit to respect maxConcurrency config
- All errors caught and returned in result object (non-throwing batch)

Per research, bitrate default 256 kbps AAC provides quality equivalent to 192 kbps MP3.
  </action>
  <verify>
    <automated>bun test src/tests/unit/MP4ConversionService.test.ts -t "conversion" 2>&1 | head -50</automated>
  </verify>
  <done>MP4ConversionService.ts exports class with convert() and convertBatch(); injects RetryService and AudioErrorClassifier; uses Bun.$ for FFmpeg execution; validates input/output files; includes Pino logging; p-limit controls concurrency; all conversions wrapped in retry logic</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Write comprehensive unit tests for MP4ConversionService</name>
  <files>src/tests/unit/MP4ConversionService.test.ts</files>
  <behavior>
    - Test: convert() with minimal metadata (title only) succeeds
    - Test: convert() with full metadata (title, artist, album, date, genre, trackNumber) succeeds
    - Test: convert() with special characters in metadata (quotes, newlines) escapes correctly
    - Test: convert() fails if input file missing, returns error in result
    - Test: convert() fails if FFmpeg exits non-zero, classifies as transient, retries
    - Test: convert() validates output file size > 0
    - Test: convertBatch() with 5 files respects p-limit maxConcurrency = 2
    - Test: convertBatch() mixed success/failure returns partial results with error field set
    - Test: config.bitrate validation (96, 256, 320 valid; 0, 1000 invalid)
    - Test: FFmpeg command builder escapes metadata with quotes correctly
  </behavior>
  <action>
Create src/tests/unit/MP4ConversionService.test.ts with tests covering:

1. **Basic Conversion (Happy Path)**
   - Input: dummy MP3 file, minimal metadata {title: "Test"}
   - Execute: convert(inputPath, outputPath, metadata)
   - Verify: output file exists, size > 0, no error field
   - Mock: FFmpeg via $` ` spy to capture command args

2. **Metadata Escaping**
   - Input: metadata with special characters: {title: `Test "quoted" title`, artist: "Line\nBreak"}
   - Execute: convert()
   - Verify: buildM4ACommand() escapes quotes, newlines don't break command
   - Mock: FFmpeg exit code 0

3. **Error Classification & Retry**
   - Input: FFmpeg fails with stderr "Unknown encoder 'invalid'"
   - Execute: convert()
   - Verify: AudioErrorClassifier.classify() called, error is transient, retryService.executeWithRetry() invoked
   - Mock: First call fails, second succeeds (simulate retry)

4. **Batch Concurrency Control**
   - Input: 5 ConvertOptions, config.maxConcurrency = 2
   - Execute: convertBatch()
   - Verify: p-limit limiter created with 2, only 2 conversions run in parallel
   - Mock: FFmpeg succeeds for all

5. **Missing Input File**
   - Input: inputPath = "/nonexistent/file.mp3"
   - Execute: convert()
   - Verify: Error caught, result.error set, no exception thrown in batch

6. **Config Validation**
   - Input: MP4ConversionConfig with bitrate = 500 (invalid)
   - Execute: loadMP4Config()
   - Verify: Zod validation throws, includes error message "bitrate must be 96-320"

Test file target: 200+ lines, >80% coverage of convert(), convertBatch(), error paths.
  </action>
  <verify>
    <automated>bun test src/tests/unit/MP4ConversionService.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>MP4ConversionService.test.ts contains 200+ lines; tests cover happy path, metadata escaping, error classification, batch concurrency, missing files, config validation; all tests use mocked FFmpeg via Bun.$ spy; coverage >80%</done>
</task>

</tasks>

<verification>
After completing all tasks in this plan:

1. **Compilation**: Run `bun check` to verify TypeScript types across MP4ConversionService, config, and utils
2. **Tests**: Execute `bun test src/tests/unit/` to confirm all unit tests pass (target: 50+ tests)
3. **Integration Check** (manual): Verify MP4ConversionService can be instantiated with real RetryService and AudioErrorClassifier (wiring tested in Phase 04-02)
4. **Linting**: Run `bunx eslint src/core/services/MP4ConversionService.ts src/core/config/MP4ConversionConfig.ts` to check code style
5. **Documentation**: Verify CLAUDE.md immutability rules applied (readonly everywhere)

Wave 1 Focus:
- MP4ConversionConfig fully functional and validated
- MP4ConversionService.convert() and convertBatch() ready for Phase 04-02 pipeline integration
- Unit tests establish baseline correctness before end-to-end wiring
</verification>

<success_criteria>
Phase 04-01 is complete when:

1. **Config Schema Works**
   - [ ] loadMP4Config() loads from env + .env + defaults
   - [ ] Zod validation rejects invalid bitrate (< 96 or > 320)
   - [ ] maxConcurrency defaults to 2, rejects values > 8

2. **Service Implements Core Logic**
   - [ ] convert() calls buildM4ACommand(), executes via Bun.$, validates output
   - [ ] convertBatch() uses p-limit with maxConcurrency
   - [ ] Both use RetryService with AudioErrorClassifier
   - [ ] All errors logged via Pino

3. **FFmpeg Command Builders Work**
   - [ ] buildM4ACommand() returns string[] (parameterized, not shell string)
   - [ ] Metadata escaping prevents shell injection
   - [ ] buildMP4WithVideoCommand() includes -shortest flag

4. **Types Support Future Phases**
   - [ ] MP4Metadata and MP4ConversionResult in audio.ts
   - [ ] All types use readonly for immutability

5. **Tests Verify Implementation**
   - [ ] All unit tests pass (bun test src/tests/unit/MP4ConversionService.test.ts)
   - [ ] Coverage >80%
   - [ ] Tests mock FFmpeg, not requiring real binary

6. **Readiness for Phase 04-02**
   - [ ] Service ready to wrap in MP4Pipeline
   - [ ] Config schema matches research recommendations (bitrate 256 kbps AAC default)
   - [ ] Error classification prepared for integration

**No E2E or real FFmpeg testing in Phase 04-01** — that's Phase 04-02's responsibility.
</success_criteria>

<output>
After execution completes:

1. Create `.planning/phases/04-mp4-conversion/04-01-SUMMARY.md` documenting:
   - Tasks completed (5 tasks: config, types, command builders, service, tests)
   - Files created: MP4ConversionConfig.ts, MP4ConversionService.ts, ffmpeg-commands.ts, unit tests
   - Test results: `bun test` output showing all tests passed
   - Code review checklist: CLAUDE.md immutability ✅, no console.log ✅, Pino logging ✅
   - Dependencies verified: RetryService, AudioErrorClassifier integration confirmed
   - Git commit message: "feat(04-mp4-01): implement MP4ConversionService with config, metadata, and retry integration"

2. Prepare for Phase 04-02:
   - MP4ConversionService ready to integrate into MP4Pipeline
   - Config loading ready to use in CLI (scripts/mp3_to_mp4.ts)
   - Test suite baseline established for Phase 04-02 E2E verification
</output>
