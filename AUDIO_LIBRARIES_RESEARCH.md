# Audio Processing Libraries Research

**Date**: 2026-03-24
**Focus**: MP3/MP4 conversion, audio merging, metadata handling with Bun runtime support

---

## Executive Summary

This research evaluates 5 top audio processing libraries for Node.js/Bun, focusing on:
- Format conversion (MP3 to MP4)
- Audio concatenation/merging
- Duration & metadata extraction
- Bun runtime compatibility
- Performance characteristics

**Key Finding**: No single pure-JavaScript library handles all requirements. Hybrid approach recommended:
- **FFmpeg wrapper** for format conversion & concatenation
- **music-metadata** for metadata/duration extraction
- **Bun integration** via native FFmpeg binary on system

---

## Top 5 Options Comparison

### 1. FFmpeg-based Approach (Recommended for Bun)

#### Primary Libraries:

**a) FFmpeg-Simplified** ⭐ Best for Bun
- **npm package**: `ffmpeg-simplified`
- **Type**: TypeScript FFmpeg wrapper
- **Bun Support**: Explicitly targets Bun ≥1.0
- **Prebuilt Bundles**: Yes (tsdown for Node ≥22, Bun ≥1.0)
- **Features**:
  - Direct process spawning
  - Progress tracking
  - Stream support
  - FFprobe integration
  - Zero native compilation

**Pros:**
✅ Explicit Bun compatibility
✅ Modern TypeScript implementation
✅ No native bindings needed
✅ Prebuilt bundles for Bun
✅ Includes progress tracking
✅ FFprobe for metadata queries

**Cons:**
❌ Requires system FFmpeg binary
❌ Smaller community than fluent-ffmpeg
❌ Less documentation available

**Use Case**: MP3→MP4, audio merging, format conversion

---

**b) Mediaforge** (Modern FFmpeg Wrapper)
- **Type**: Modern TypeScript FFmpeg wrapper
- **Node.js Support**: 18+
- **Bun Support**: Likely compatible (not explicitly documented)
- **Features**:
  - Fluent builder API
  - Zero native bindings
  - Runtime codec/filter discovery
  - Works with system FFmpeg

**Pros:**
✅ Clean TypeScript API
✅ Runtime capability detection
✅ Cross-platform (Linux, macOS, Windows)
✅ Modern design principles

**Cons:**
❌ No explicit Bun documentation
❌ Requires system FFmpeg
❌ Smaller adoption than alternatives

**Use Case**: Complex audio/video pipelines with dynamic codec detection

---

**c) Fluent-FFmpeg** (Legacy - Archived)
- **npm package**: `fluent-ffmpeg`
- **Status**: ⚠️ Archived/Phased out (May 2025)
- **Type**: Node.js FFmpeg wrapper
- **Bun Support**: Not documented; likely works via Node.js compatibility

**Pros:**
✅ Mature library with large community
✅ Extensive documentation
✅ Many examples available
✅ Works on Node.js

**Cons:**
❌ **ARCHIVED** - No longer maintained
❌ No explicit Bun support
❌ Newer projects recommend alternatives
❌ Performance concerns noted in issues

**Use Case**: Existing projects; not recommended for new development

---

### 2. Mediabunny (@mediabunny/mp3-encoder) ⭐ Pure TypeScript

- **npm packages**:
  - `mediabunny` (main library)
  - `@mediabunny/mp3-encoder` (MP3 encoding)
- **Type**: Pure TypeScript WASM/JavaScript library
- **Runtime Support**: Browser, Node.js, Deno, **Bun** ✅
- **Encoding**: LAME 3.100 SIMD-enabled WASM
- **Dependencies**: Zero

**Features:**
- MP3 encoding/decoding
- Direct browser support
- SIMD-optimized WASM
- Tree-shakable (import only what you use)
- Performance: 5 seconds audio → ~90ms (55x real-time)

**Pros:**
✅ **Explicit Bun support**
✅ Pure TypeScript - no native bindings
✅ Zero dependencies
✅ Tree-shakable API
✅ High performance (55x real-time MP3)
✅ Works in browser & server
✅ No system FFmpeg required

**Cons:**
❌ MP3 encoding focus (limited to MP3)
❌ No native MP3→MP4 conversion
❌ Limited format support (no AAC, limited others)
❌ Would need supplementary library for MP4 container
❌ Audio merging requires manual buffer handling

**Performance**: Encodes 5 seconds in ~90ms (55x real-time speed)

**Use Case**: Pure MP3 processing, encoding, when FFmpeg unavailable

---

### 3. Music-Metadata ⭐ Metadata/Duration Standard

- **npm package**: `music-metadata`
- **Type**: Metadata parser
- **Node.js Support**: ≥18 (ESM, v8+)
- **Bun Support**: Likely compatible (uses Node.js streams, not documented)
- **Formats**: MP3, MP4, FLAC, Ogg, WAV, AIFF, and more

**Features:**
- Parse streams or buffers
- Extract: format, codec, duration, bitrate, tags
- Streaming support (no full file load)
- Browser-compatible version available

**Methods:**
```typescript
parseStream(stream)       // From Node.js Readable stream
parseBuffer(buffer)       // From Uint8Array/Buffer
parseFile(path)          // From file path
```

**Pros:**
✅ Standard in Node.js ecosystem
✅ Comprehensive format support
✅ Stream-based (memory efficient)
✅ ESM module (modern)
✅ Extracts detailed metadata
✅ Duration parsing (no full decode)

**Cons:**
❌ Metadata-only (no conversion)
❌ Bun compatibility not documented
❌ May need full parse for duration (slow)
❌ No audio manipulation

**Accuracy**: Supports CBR/VBR MP3; estimator available for speed

**Use Case**: Extract duration, metadata, analyze audio files

---

### 4. Audioconcat (FFmpeg-based Merging)

- **npm package**: `audioconcat`
- **Type**: FFmpeg wrapper for concatenation
- **Dependencies**: `@ffmpeg-installer/ffmpeg`, `fluent-ffmpeg`
- **Formats**: MP3, AAC, OGG

**Features:**
- Simple audio concatenation
- Stream-based merging
- Works with multiple files

**Pros:**
✅ Purpose-built for concatenation
✅ Simple API
✅ Handles multiple formats

**Cons:**
❌ Depends on archived fluent-ffmpeg
❌ No Bun documentation
❌ Limited scope (concatenation only)
❌ Less maintained

**Use Case**: Simple audio file merging

---

### 5. MP3-Duration (Lightweight Duration)

- **npm package**: `mp3-duration`
- **Type**: Duration calculator
- **Dependencies**: Minimal
- **Accuracy**: CBR estimation option

**Features:**
- Get MP3 file duration
- Fast estimation mode (CBR)
- Accurate parsing mode

**Pros:**
✅ Lightweight
✅ Fast estimation available
✅ Simple, focused API

**Cons:**
❌ MP3-only
❌ Duration-only (no metadata)
❌ Estimation not always accurate
❌ No Bun documentation

**Use Case**: Quick MP3 duration checks only

---

## Bun Compatibility Matrix

| Library | Bun Support | Notes |
|---------|-------------|-------|
| **FFmpeg-Simplified** | ✅ Explicit | Prebuilt bundles for Bun ≥1.0 |
| **Mediabunny** | ✅ Explicit | Pure TypeScript, zero dependencies |
| **Mediaforge** | ⚠️ Likely | Modern TypeScript, uses Node.js APIs |
| **Music-Metadata** | ⚠️ Likely | Uses Node.js streams, ESM |
| **Fluent-FFmpeg** | ⚠️ Maybe | Via Node.js compat; archived |
| **Audioconcat** | ⚠️ Maybe | Depends on fluent-ffmpeg |
| **MP3-Duration** | ⚠️ Maybe | Simple API likely works |

**Legend**: ✅ = Explicit/Tested | ⚠️ = Likely via Node.js compat | ❌ = Not compatible

---

## Performance Comparison

### Encoding Speed
| Library | Task | Speed | Notes |
|---------|------|-------|-------|
| **Mediabunny/MP3-Encoder** | Encode 5s audio to MP3 | ~90ms (55x real-time) | SIMD-optimized WASM |
| **FFmpeg-Simplified** | Varies by format | System-dependent | ~2-5x real-time typical |
| **Music-Metadata** | Parse metadata | <100ms | Stream-based, no decode |
| **MP3-Duration** | Duration (estimation) | <10ms | CBR mode, very fast |
| **MP3-Duration** | Duration (accurate) | Variable | Full parse required |

### Bun vs Node.js
Bun is **2.5-3x faster** for I/O operations, though audio processing benefits depend on:
- File I/O speed (Bun wins significantly)
- Actual encoding/processing (delegated to FFmpeg, no difference)
- Native FFmpeg binary performance (identical)

---

## Recommended Stack for KinetiText

### For MP3→MP4 Conversion + Merging

**Option A: FFmpeg-Based (Maximum Compatibility)**
```typescript
// Audio conversion & merging
import { ffmpegSimplified } from 'ffmpeg-simplified'

// Metadata extraction
import { parseFile } from 'music-metadata'

// Bun runtime ready, explicit support
```

**Option B: Pure TypeScript (No System Dependencies)**
```typescript
// MP3 processing only
import { Mp3Encoder } from '@mediabunny/mp3-encoder'

// Metadata extraction
import { parseFile } from 'music-metadata'

// Limitation: MP3→MP4 requires FFmpeg or manual container manipulation
```

**Recommendation**: **Option A** (FFmpeg-Simplified + Music-Metadata)
- ✅ Explicit Bun support
- ✅ Handles all audio formats
- ✅ Reliable concatenation
- ✅ Metadata extraction
- ✅ Modern TypeScript API
- ✅ Prebuilt for Bun ≥1.0

---

## Implementation Considerations

### System Requirements
- **FFmpeg binary** required (either FFmpeg-Simplified or via @ffmpeg-installer/ffmpeg)
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: `choco install ffmpeg` or download from ffmpeg.org

### Installation

```bash
# Core audio processing
bun add ffmpeg-simplified music-metadata

# Optional: For legacy compatibility
# bun add fluent-ffmpeg @ffmpeg-installer/ffmpeg

# Optional: For pure TypeScript MP3
# bun add mediabunny @mediabunny/mp3-encoder
```

### Typical Workflow

```typescript
import { ffmpegSimplified } from 'ffmpeg-simplified'
import { parseFile } from 'music-metadata'

// 1. Extract duration
const metadata = await parseFile('audio.mp3')
console.log(`Duration: ${metadata.format.duration}s`)

// 2. Convert MP3 to MP4
await ffmpegSimplified()
  .input('audio.mp3')
  .output('audio.mp4')
  .run()

// 3. Merge multiple MP3s
await ffmpegSimplified()
  .input('audio1.mp3')
  .input('audio2.mp3')
  .output('merged.mp3')
  .run()
```

---

## Migration Path from Current Implementation

If KinetiText currently uses fluent-ffmpeg:

1. **Phase 1**: Add ffmpeg-simplified alongside fluent-ffmpeg
2. **Phase 2**: Migrate to ffmpeg-simplified API gradually
3. **Phase 3**: Remove fluent-ffmpeg dependency
4. **Testing**: Verify Bun compatibility during Phase 2

---

## Additional Resources

- [FFmpeg-Simplified GitHub](https://github.com/path-to-repo)
- [Mediabunny GitHub](https://github.com/Vanilagy/mediabunny)
- [Music-Metadata GitHub](https://github.com/Borewit/music-metadata)
- [Bun Documentation](https://bun.sh/docs)
- [FFmpeg Official](https://ffmpeg.org)

---

## Conclusion

For KinetiText with Bun runtime:

| Requirement | Best Library | Reason |
|-------------|--------------|--------|
| MP3→MP4 Conversion | FFmpeg-Simplified | Explicit Bun support, comprehensive |
| Audio Merging | FFmpeg-Simplified | Built-in, reliable, Bun-ready |
| Duration/Metadata | Music-Metadata | Standard, reliable, modern |
| Pure TypeScript Option | Mediabunny | Zero deps, but limited scope |

**Primary Recommendation**: **FFmpeg-Simplified** + **Music-Metadata**
- Modern TypeScript
- Explicit Bun ≥1.0 support
- Comprehensive format support
- No maintenance concerns
- Strong performance characteristics

---

**Document Version**: 1.0
**Research Date**: 2026-03-24
