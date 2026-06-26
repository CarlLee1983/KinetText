/**
 * FFmpeg command builders for M4A and MP4 conversion
 * Creates parameterized command arrays (not shell strings) for Bun.$ execution
 */

import { MP4Metadata } from '../types/audio'
import { getLogger } from './logger'

const logger = getLogger('ffmpeg-commands')

/**
 * Escape metadata strings to prevent shell injection
 * Uses JSON.stringify to ensure special characters are properly escaped
 */
function escapeMetadata(value: string): string {
  // Use JSON.stringify and then strip the outer quotes
  // This handles quotes, newlines, and other special characters correctly
  return JSON.stringify(value).slice(1, -1)
}

/**
 * Build FFmpeg command for MP3→M4A conversion with metadata
 * Returns a string array suitable for Bun.$ execution
 *
 * @param inputPath Path to input MP3 file
 * @param outputPath Path to output M4A file
 * @param bitrate Bitrate in kbps (96-320; typically 256 for AAC)
 * @param metadata Optional metadata to embed (title, artist, album, etc.)
 * @returns String array of FFmpeg arguments (not a shell string)
 *
 * @example
 * const cmd = buildM4ACommand('/path/in.mp3', '/path/out.m4a', 256)
 * await $`ffmpeg ${cmd}`.quiet()
 */
export function buildM4ACommand(
  inputPath: string,
  outputPath: string,
  bitrate: number,
  metadata?: Readonly<MP4Metadata>
): string[] {
  // Validate bitrate range
  if (bitrate < 96 || bitrate > 320) {
    throw new Error(`Invalid bitrate: ${bitrate} kbps (must be 96-320)`)
  }

  const args: string[] = [
    '-y', // Overwrite output without prompt
    '-i', inputPath,
    '-c:a', 'aac', // Use AAC codec (MP3 in MP4 container not standard)
    '-b:a', `${bitrate}k`, // Set audio bitrate
    '-movflags', '+faststart' // Optimize for streaming (metadata at start)
  ]

  // Add metadata flags if provided
  if (metadata) {
    if (metadata.title) {
      args.push('-metadata', `title=${escapeMetadata(metadata.title)}`)
    }
    if (metadata.artist) {
      args.push('-metadata', `artist=${escapeMetadata(metadata.artist)}`)
    }
    if (metadata.album) {
      args.push('-metadata', `album=${escapeMetadata(metadata.album)}`)
    }
    if (metadata.date) {
      args.push('-metadata', `date=${escapeMetadata(metadata.date)}`)
    }
    if (metadata.genre) {
      args.push('-metadata', `genre=${escapeMetadata(metadata.genre)}`)
    }
    if (metadata.trackNumber !== undefined) {
      args.push('-metadata', `track=${metadata.trackNumber}`)
    }
    if (metadata.comment) {
      args.push('-metadata', `comment=${escapeMetadata(metadata.comment)}`)
    }
  }

  args.push(outputPath)

  logger.debug({
    input: inputPath,
    output: outputPath,
    bitrate,
    metadataFields: metadata ? Object.keys(metadata).length : 0
  }, 'Built M4A conversion command')

  return args
}

/**
 * Build FFmpeg command for M4A with black video background
 * Creates a static black video stream and combines with audio
 * Used for generating MP4 files playable in video players
 *
 * @param audioPath Path to input audio file (M4A or MP3)
 * @param outputPath Path to output MP4 file
 * @param bitrate Audio bitrate in kbps
 * @param width Video width in pixels
 * @param height Video height in pixels
 * @param metadata Optional metadata to embed
 * @returns String array of FFmpeg arguments
 *
 * @example
 * const cmd = buildMP4WithVideoCommand('/path/audio.m4a', '/path/out.mp4', 256, 1920, 1080)
 * await $`ffmpeg ${cmd}`.quiet()
 */
export function buildMP4WithVideoCommand(
  audioPath: string,
  outputPath: string,
  bitrate: number,
  width: number,
  height: number,
  metadata?: Readonly<MP4Metadata>
): string[] {
  // Validate parameters
  if (bitrate < 96 || bitrate > 320) {
    throw new Error(`Invalid bitrate: ${bitrate} kbps (must be 96-320)`)
  }
  if (width < 320 || width > 7680) {
    throw new Error(`Invalid video width: ${width} (must be 320-7680)`)
  }
  if (height < 240 || height > 4320) {
    throw new Error(`Invalid video height: ${height} (must be 240-4320)`)
  }

  const args: string[] = [
    '-y', // Overwrite output without prompt
    '-f', 'lavfi',
    '-i', `color=c=black:s=${width}x${height}:r=1`,
    '-i', audioPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-tune', 'stillimage',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', `${bitrate}k`,
    '-map', '0', // Map video stream
    '-map', '1', // Map audio stream
    '-shortest', // Stop at end of shorter stream (typically audio ends first)
    '-movflags', '+faststart' // Optimize for streaming
  ]

  // Add metadata flags if provided
  if (metadata) {
    if (metadata.title) {
      args.push('-metadata', `title=${escapeMetadata(metadata.title)}`)
    }
    if (metadata.artist) {
      args.push('-metadata', `artist=${escapeMetadata(metadata.artist)}`)
    }
    if (metadata.album) {
      args.push('-metadata', `album=${escapeMetadata(metadata.album)}`)
    }
  }

  args.push(outputPath)

  logger.debug({
    audio: audioPath,
    output: outputPath,
    bitrate,
    videoResolution: `${width}x${height}`
  }, 'Built MP4 with video conversion command')

  return args
}

/**
 * Build FFmpeg command for MP3/M4A with a static cover image (YouTube-friendly MP4)
 */
export function buildMP4WithImageCommand(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  bitrate: number,
  width: number,
  height: number,
  metadata?: Readonly<MP4Metadata>
): string[] {
  if (bitrate < 96 || bitrate > 320) {
    throw new Error(`Invalid bitrate: ${bitrate} kbps (must be 96-320)`)
  }

  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
  const args: string[] = [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-i', audioPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-tune', 'stillimage',
    '-vf', scalePad,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', `${bitrate}k`,
    '-map', '0:v',
    '-map', '1:a',
    '-shortest',
    '-movflags', '+faststart',
  ]

  if (metadata) {
    if (metadata.title) args.push('-metadata', `title=${escapeMetadata(metadata.title)}`)
    if (metadata.artist) args.push('-metadata', `artist=${escapeMetadata(metadata.artist)}`)
    if (metadata.album) args.push('-metadata', `album=${escapeMetadata(metadata.album)}`)
  }

  args.push(outputPath)
  return args
}

/**
 * 建構 M4B 有聲書 ffmpeg 參數陣列
 * concat demuxer 串接各章音檔 + 嵌入 FFMETADATA（章節）+ 選配封面，重編碼 AAC
 *
 * @param concatListPath ffmpeg concat list 檔路徑（內含 file '...' 各行）
 * @param ffmetadataPath FFMETADATA 檔路徑
 * @param outputPath 輸出 .m4b 路徑
 * @param bitrate AAC 位元率 kbps（96–320）
 * @param coverPath 選配封面圖路徑（jpg/png）
 * @returns ffmpeg 參數字串陣列（非 shell 字串）
 */
export function buildM4BCommand(
  concatListPath: string,
  ffmetadataPath: string,
  outputPath: string,
  bitrate: number,
  coverPath?: string,
): string[] {
  if (bitrate < 96 || bitrate > 320) {
    throw new Error(`Invalid bitrate: ${bitrate} kbps (must be 96-320)`)
  }

  const args: string[] = [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-i', ffmetadataPath,
  ]

  if (coverPath) {
    args.push('-i', coverPath)
  }

  args.push('-map_metadata', '1', '-map', '0:a')

  if (coverPath) {
    args.push('-map', '2:v', '-disposition:v:0', 'attached_pic', '-c:v', 'copy')
  }

  args.push('-c:a', 'aac', '-b:a', `${bitrate}k`, '-movflags', '+faststart', outputPath)

  return args
}

/**
 * 跳脫 drawtext filter 的特殊字元（: \ % 反斜線），避免破壞 filter 語法。
 * 注意：drawtext 在 filter 字串內以 ':' 分隔選項，故文字內的 ':' 必須跳脫。
 */
export function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
}

/**
 * 建構靜態封面 ffmpeg 參數陣列：純色底 + 書名（大字）+ partN（小字），輸出單張 jpg。
 */
export function buildCoverImageCommand(opts: {
  title: string
  partLabel: string
  outPath: string
  font: string
  width?: number
  height?: number
  bg?: string
}): string[] {
  const width = opts.width ?? 1920
  const height = opts.height ?? 1080
  const bg = opts.bg ?? '#1a1a2e'
  const titleSize = Math.round(height / 12)
  const partSize = Math.round(height / 24)
  const escTitle = escapeDrawtext(opts.title)
  const escPart = escapeDrawtext(opts.partLabel)
  const font = opts.font

  const titleDraw =
    `drawtext=fontfile=${font}:text=${escTitle}:fontcolor=white:fontsize=${titleSize}` +
    `:x=(w-text_w)/2:y=(h/2)-${titleSize}`
  const partDraw =
    `drawtext=fontfile=${font}:text=${escPart}:fontcolor=#b0b0c0:fontsize=${partSize}` +
    `:x=(w-text_w)/2:y=(h/2)+${Math.round(titleSize / 2)}`

  return [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${bg}:s=${width}x${height}`,
    '-vf', `${titleDraw},${partDraw}`,
    '-frames:v', '1',
    opts.outPath,
  ]
}
