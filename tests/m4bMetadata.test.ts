import { describe, expect, test } from 'bun:test'
import { parseChapterTitle, buildFFMetadata } from '../src/core/utils/m4b-metadata'

describe('parseChapterTitle', () => {
  test('strips NNNN - prefix and extension', () => {
    expect(parseChapterTitle('0001 - 第一章林四九.mp3')).toBe('第一章林四九')
  })
  test('falls back to filename without extension when no prefix', () => {
    expect(parseChapterTitle('前言.mp3')).toBe('前言')
  })
  test('handles 5-digit index', () => {
    expect(parseChapterTitle('10234 - 終章.mp3')).toBe('終章')
  })
})

describe('buildFFMetadata', () => {
  test('emits header and chapter blocks with cumulative timebase 1/1000', () => {
    const out = buildFFMetadata(
      [
        { title: '第一章', durationSec: 1.5 },
        { title: '第二章', durationSec: 2 },
      ],
      { album: '某書', artist: 'KinetiText TTS', title: '某書 第1卷' },
    )
    expect(out.startsWith(';FFMETADATA1\n')).toBe(true)
    expect(out).toContain('album=某書')
    expect(out).toContain('artist=KinetiText TTS')
    expect(out).toContain('title=某書 第1卷')
    expect(out).toContain('[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=第一章')
    expect(out).toContain('[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3500\ntitle=第二章')
  })
  test('escapes special characters = ; # and backslash', () => {
    const out = buildFFMetadata([{ title: 'a=b;c#d\\e', durationSec: 1 }], { album: 'x' })
    expect(out).toContain('title=a\\=b\\;c\\#d\\\\e')
  })
})
