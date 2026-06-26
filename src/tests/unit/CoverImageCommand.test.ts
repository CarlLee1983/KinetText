import { test, expect } from 'bun:test'
import { buildCoverImageCommand, escapeDrawtext } from '../../core/utils/ffmpeg-commands'

test('escapeDrawtext escapes drawtext special chars', () => {
  expect(escapeDrawtext('A:B\\C%D')).toBe('A\\:B\\\\C\\%D')
})

test('buildCoverImageCommand produces lavfi color + two drawtext + single frame', () => {
  const cmd = buildCoverImageCommand({
    title: '我就守個島',
    partLabel: 'part1',
    outPath: '/out/cover.jpg',
    font: '/System/Library/Fonts/PingFang.ttc',
  })
  const joined = cmd.join(' ')
  // 預設解析度
  expect(joined).toContain('color=c=#1a1a2e:s=1920x1080')
  // 兩段 drawtext，含字型與文字
  expect(joined).toContain('fontfile=/System/Library/Fonts/PingFang.ttc')
  expect(joined).toContain('text=我就守個島')
  expect(joined).toContain('text=part1')
  // 單張輸出 + 輸出路徑在最後
  expect(cmd).toContain('-frames:v')
  expect(cmd[cmd.length - 1]).toBe('/out/cover.jpg')
  // 必須是陣列、首位為 -y
  expect(cmd[0]).toBe('-y')
})

test('buildCoverImageCommand escapes colon in title', () => {
  const cmd = buildCoverImageCommand({
    title: '番外:終章',
    partLabel: 'part2',
    outPath: '/out/c.jpg',
    font: '/f.ttc',
  })
  expect(cmd.join(' ')).toContain('text=番外\\:終章')
})

test('escapeDrawtext escapes comma, single-quote, and square brackets', () => {
  // Input: A,B'C[D]  — each special char must be backslash-escaped
  expect(escapeDrawtext("A,B'C[D]")).toBe("A\\,B\\'C\\[D\\]")
})
