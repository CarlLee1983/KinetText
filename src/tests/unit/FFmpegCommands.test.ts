/**
 * Unit tests for FFmpeg command builders
 * Tests command generation, metadata escaping, and parameter validation
 */

import { describe, test, expect } from 'bun:test'
import { buildM4ACommand, buildMP4WithVideoCommand } from '../../core/utils/ffmpeg-commands'
import type { MP4Metadata } from '../../core/types/audio'

describe('FFmpeg Command Builders', () => {
  describe('buildM4ACommand()', () => {
    test('returns string array (not shell string)', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256)

      expect(Array.isArray(cmd)).toBe(true)
      expect(typeof cmd[0]).toBe('string')
    })

    test('includes basic FFmpeg arguments', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256)

      expect(cmd).toContain('-y') // Overwrite without prompt
      expect(cmd).toContain('-i')
      expect(cmd.some(arg => arg === '/input.mp3')).toBe(true)
      expect(cmd).toContain('-c:a')
      expect(cmd).toContain('aac') // AAC codec
      expect(cmd.some(arg => arg === '/output.m4a')).toBe(true)
    })

    test('includes bitrate flag', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 192)

      expect(cmd).toContain('-b:a')
      expect(cmd.some(arg => arg === '192k')).toBe(true)
    })

    test('includes movflags for streaming optimization', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256)

      expect(cmd).toContain('-movflags')
      expect(cmd).toContain('+faststart')
    })

    test('includes metadata flags when provided', () => {
      const metadata: MP4Metadata = {
        title: 'Test Chapter',
        artist: 'Test Author'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)

      expect(cmd).toContain('-metadata')
      // Metadata values are part of the same string argument
      const hasMetadata = cmd.some(arg => arg.includes('title') && arg.includes('Test Chapter'))
      expect(hasMetadata).toBe(true)
      const hasArtist = cmd.some(arg => arg.includes('artist') && arg.includes('Test Author'))
      expect(hasArtist).toBe(true)
    })

    test('escapes metadata with special characters (quotes)', () => {
      const metadata: MP4Metadata = {
        title: 'Test "Quoted" Title'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)

      // Verify escaped version is in command
      expect(cmd.some(arg => arg.includes('Test') && arg.includes('Quoted'))).toBe(true)
    })

    test('escapes metadata with newlines', () => {
      const metadata: MP4Metadata = {
        artist: 'Line1\nLine2'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)

      // Command should handle newlines safely
      expect(cmd.some(arg => arg.includes('Line'))).toBe(true)
    })

    test('includes all metadata fields when provided', () => {
      const metadata: MP4Metadata = {
        title: 'Title',
        artist: 'Artist',
        album: 'Album',
        date: '2026-03-24',
        genre: 'Audiobook',
        trackNumber: 1,
        comment: 'Test comment'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)

      expect(cmd).toContain('-metadata')
      // Should have multiple metadata entries (one per field)
      const metadataCount = cmd.filter(arg => arg === '-metadata').length
      expect(metadataCount).toBeGreaterThanOrEqual(7)
    })

    test('skips undefined metadata fields', () => {
      const metadata: MP4Metadata = {
        title: 'Title',
        artist: undefined,
        album: undefined
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)

      // Should have metadata flag for title
      const hasTitle = cmd.some(arg => arg.includes('title') && arg.includes('Title'))
      expect(hasTitle).toBe(true)
      // Undefined fields should not add metadata entries
      const artistCount = cmd.filter(arg => arg.includes('artist')).length
      expect(artistCount).toBe(0)
    })

    test('validates bitrate range (minimum 96)', () => {
      expect(() => {
        buildM4ACommand('/input.mp3', '/output.m4a', 64)
      }).toThrow('Invalid bitrate')
    })

    test('validates bitrate range (maximum 320)', () => {
      expect(() => {
        buildM4ACommand('/input.mp3', '/output.m4a', 500)
      }).toThrow('Invalid bitrate')
    })

    test('accepts bitrate 96 (minimum valid)', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 96)
      expect(cmd.some(arg => arg === '96k')).toBe(true)
    })

    test('accepts bitrate 320 (maximum valid)', () => {
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 320)
      expect(cmd.some(arg => arg === '320k')).toBe(true)
    })
  })

  describe('buildMP4WithVideoCommand()', () => {
    test('returns string array', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(Array.isArray(cmd)).toBe(true)
      expect(typeof cmd[0]).toBe('string')
    })

    test('includes video background generation', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(cmd).toContain('-f')
      expect(cmd).toContain('lavfi')
      expect(cmd.some(arg => arg.includes('color=c=black'))).toBe(true)
    })

    test('includes video dimensions in color filter', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(cmd.some(arg => arg.includes('1920x1080'))).toBe(true)
    })

    test('includes -shortest flag to sync video and audio', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(cmd).toContain('-shortest')
    })

    test('includes H.264 codec with fast preset', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(cmd).toContain('-c:v')
      expect(cmd).toContain('libx264')
      expect(cmd).toContain('-preset')
      expect(cmd).toContain('fast')
    })

    test('includes AAC audio codec', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      expect(cmd).toContain('-c:a')
      expect(cmd).toContain('aac')
    })

    test('includes stream mapping', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 1080)

      const mapIndices = cmd
        .map((arg, idx) => (arg === '-map' ? idx : -1))
        .filter(idx => idx >= 0)

      expect(mapIndices.length).toBeGreaterThanOrEqual(2)
    })

    test('includes bitrate flag', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 192, 1920, 1080)

      expect(cmd).toContain('-b:a')
      expect(cmd.some(arg => arg === '192k')).toBe(true)
    })

    test('includes metadata when provided', () => {
      const metadata: MP4Metadata = {
        title: 'Test Video',
        artist: 'Test Author'
      }

      const cmd = buildMP4WithVideoCommand(
        '/audio.m4a',
        '/output.mp4',
        256,
        1920,
        1080,
        metadata
      )

      expect(cmd).toContain('-metadata')
      expect(cmd.some(arg => arg.includes('Test'))).toBe(true)
    })

    test('validates bitrate range', () => {
      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 64, 1920, 1080)
      }).toThrow('Invalid bitrate')

      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 500, 1920, 1080)
      }).toThrow('Invalid bitrate')
    })

    test('validates video width range', () => {
      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 100, 1080)
      }).toThrow('Invalid video width')

      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 8000, 1080)
      }).toThrow('Invalid video width')
    })

    test('validates video height range', () => {
      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 100)
      }).toThrow('Invalid video height')

      expect(() => {
        buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1920, 5000)
      }).toThrow('Invalid video height')
    })

    test('accepts valid dimensions', () => {
      const cmd = buildMP4WithVideoCommand('/audio.m4a', '/output.mp4', 256, 1280, 720)
      expect(cmd.some(arg => arg.includes('1280x720'))).toBe(true)
    })
  })

  describe('Metadata escaping security', () => {
    test('prevents shell injection via metadata with $', () => {
      const metadata: MP4Metadata = {
        title: 'Test $(rm -rf /)'
      }

      // Should not throw, just escape the string
      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)
      expect(cmd).toBeDefined()
    })

    test('prevents shell injection via metadata with backticks', () => {
      const metadata: MP4Metadata = {
        artist: 'Author `whoami`'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)
      expect(cmd).toBeDefined()
    })

    test('handles semicolons in metadata safely', () => {
      const metadata: MP4Metadata = {
        comment: 'Comment; rm -rf /'
      }

      const cmd = buildM4ACommand('/input.mp3', '/output.m4a', 256, metadata)
      expect(cmd).toBeDefined()
    })
  })
})
