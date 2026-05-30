import { test, expect } from 'bun:test'
import { formatStageCell, overallLabel } from '../../src/tui/status'

test('formatStageCell 完成顯示 ✓', () => {
  expect(formatStageCell(716, 716)).toBe('716/716 ✓')
})

test('formatStageCell 部分完成不加勾', () => {
  expect(formatStageCell(280, 320)).toBe('280/320')
})

test('formatStageCell 未開始顯示破折號', () => {
  expect(formatStageCell(0, 0)).toBe('—')
})

test('overallLabel 對應中文狀態', () => {
  expect(overallLabel('complete')).toContain('完成')
  expect(overallLabel('tts')).toContain('TTS')
  expect(overallLabel('created')).toContain('建立')
})
