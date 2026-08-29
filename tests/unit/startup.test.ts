import { describe, expect, test } from 'bun:test'
import { checkStartup, formatStartupReport } from '../../src/diagnostics/startup'
import { evaluateProfile } from '../../src/diagnostics/evaluate'
import { getProfile } from '../../src/diagnostics/profiles'
import type { ProbeOutcome } from '../../src/diagnostics/types'

const ffmpegPresent: ProbeOutcome = { id: 'ffmpeg', present: true, version: '7.1' }
const ffmpegMissing: ProbeOutcome = { id: 'ffmpeg', present: false, detail: 'not-found' }
const durationNotWired: ProbeOutcome = { id: 'go-duration', present: false, detail: 'not-wired' }

/** 注入固定的探測結果，讓啟動檢查不需要實際安裝任何工具即可測試。 */
function probeWith(outcomes: readonly ProbeOutcome[]) {
  return async (ids: readonly string[]) => outcomes.filter((o) => ids.includes(o.id))
}

describe('checkStartup', () => {
  test('存在阻斷項時回報 blocked，流程不得啟動', async () => {
    const report = await checkStartup('m4b', {
      probe: probeWith([ffmpegMissing, durationNotWired]),
    })

    expect(report.blocked).toBe(true)
    expect(report.verdict.canProceed).toBe(false)
  })

  test('只有警告時不阻擋，流程可以繼續', async () => {
    const report = await checkStartup('m4b', {
      probe: probeWith([ffmpegPresent, durationNotWired]),
    })

    expect(report.blocked).toBe(false)
    expect(report.verdict.warnings.map((c) => c.id)).toEqual(['go-duration'])
  })

  test('全部可用時不阻擋且無警告', async () => {
    const report = await checkStartup('m4b', {
      probe: probeWith([ffmpegPresent, { id: 'go-duration', present: true }]),
    })

    expect(report.blocked).toBe(false)
    expect(report.verdict.warnings).toHaveLength(0)
  })

  test('含爬取階段的流程在給定適配器時納入其前置條件', async () => {
    const report = await checkStartup('crawl', {
      adapter: { siteName: 'needs-browser', requiredCapabilities: ['browser'] },
      probe: probeWith([{ id: 'browser', present: false, detail: 'unavailable' }]),
    })

    expect(report.blocked).toBe(true)
    expect(report.verdict.blocking.map((c) => c.id)).toEqual(['browser'])
  })

  test('未給適配器時，爬取流程不含任何適配器前置條件', async () => {
    const report = await checkStartup('crawl', { probe: probeWith([]) })

    expect(report.blocked).toBe(false)
    expect(report.verdict.capabilities).toHaveLength(0)
  })

  test('未知的設定檔名稱是程式錯誤，直接拋出', async () => {
    await expect(checkStartup('nope', { probe: probeWith([]) })).rejects.toThrow('nope')
  })

  test('啟動檢查與手動診斷對同一組探測結果得到相同判定', async () => {
    const outcomes = [ffmpegPresent, durationNotWired]
    const report = await checkStartup('m4b', { probe: probeWith(outcomes) })
    const manual = evaluateProfile(getProfile('m4b')!, outcomes)

    expect(report.verdict.canProceed).toBe(manual.canProceed)
    expect(report.verdict.capabilities.map((c) => `${c.id}:${c.state}`)).toEqual(
      manual.capabilities.map((c) => `${c.id}:${c.state}`)
    )
  })
})

describe('formatStartupReport', () => {
  test('阻斷時說明是哪一項並附修復資訊', () => {
    const verdict = evaluateProfile(getProfile('m4b')!, [ffmpegMissing, durationNotWired])
    const text = formatStartupReport(verdict)

    expect(text).toContain('ffmpeg')
    expect(text).toContain('brew install ffmpeg')
    expect(text).toContain('不啟動')
  })

  test('警告時說明將採取的回退行為，並表明流程會繼續', () => {
    const verdict = evaluateProfile(getProfile('m4b')!, [ffmpegPresent, durationNotWired])
    const text = formatStartupReport(verdict)

    expect(text).toContain('沒有任何流程接上')
    expect(text).toContain('繼續')
  })

  test('全部可用時不產生任何雜訊', () => {
    const verdict = evaluateProfile(getProfile('m4b')!, [
      ffmpegPresent,
      { id: 'go-duration', present: true },
    ])

    expect(formatStartupReport(verdict)).toBe('')
  })

  test('不含任何略過阻斷的提示——阻斷項不可略過', () => {
    const verdict = evaluateProfile(getProfile('m4b')!, [ffmpegMissing])
    const text = formatStartupReport(verdict)

    expect(text).not.toContain('--force')
    expect(text).not.toContain('略過')
  })
})

describe('由網址解析適配器（yt-pipeline 走的分支）', () => {
  test('需要瀏覽器的網址讓爬取流程納入該前置條件', async () => {
    const report = await checkStartup('crawl', {
      url: 'https://czbooks.net/n/abcdef',
      probe: probeWith([{ id: 'browser', present: false, detail: 'unavailable' }]),
    })

    expect(report.blocked).toBe(true)
    expect(report.verdict.blocking.map((c) => c.id)).toEqual(['browser'])
  })

  test('純 HTTP 的網址不引入瀏覽器需求', async () => {
    const report = await checkStartup('crawl', {
      url: 'https://www.8novel.com/novelbooks/12345/',
      probe: probeWith([{ id: 'browser', present: false, detail: 'unavailable' }]),
    })

    expect(report.blocked).toBe(false)
    expect(report.verdict.capabilities).toHaveLength(0)
  })

  test('沒有適配器認得的網址不引入任何前置條件', async () => {
    const report = await checkStartup('crawl', {
      url: 'https://nobody-knows-this.example/',
      probe: probeWith([]),
    })

    expect(report.blocked).toBe(false)
    expect(report.verdict.capabilities).toHaveLength(0)
  })

  test('youtube 也會依網址納入適配器前置條件——第一階段就是爬取', async () => {
    const report = await checkStartup('youtube', {
      url: 'https://czbooks.net/n/abcdef',
      probe: probeWith([
        { id: 'ffmpeg', present: true, version: '7.1' },
        { id: 'go-duration', present: true },
        { id: 'browser', present: false, detail: 'unavailable' },
      ]),
    })

    expect(report.blocked).toBe(true)
    expect(report.verdict.blocking.map((c) => c.id)).toEqual(['browser'])
  })
})
