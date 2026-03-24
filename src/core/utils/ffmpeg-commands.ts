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
    '-i', `color=c=black:s=${width}x${height}`, // Black video background
    '-i', audioPath, // Audio input
    '-c:v', 'libx264', // H.264 video codec
    '-preset', 'fast', // Balance quality and speed
    '-c:a', 'aac', // AAC audio codec
    '-b:a', `${bitrate}k`, // Audio bitrate
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
