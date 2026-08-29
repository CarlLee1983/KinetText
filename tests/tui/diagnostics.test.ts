import { describe, expect, spyOn, test } from 'bun:test'
import {
  createDiagnosticsSession,
  formatSummary,
  type DiagnosticsSummary,
} from '../../src/tui/diagnostics'
import type { ProbeOutcome } from '../../src/diagnostics/types'

const ffmpegPresent: ProbeOutcome = { id: 'ffmpeg', present: true, version: '7.1' }
const ffmpegMissing: ProbeOutcome = { id: 'ffmpeg', present: false, detail: 'not-found' }
const durationNotWired: ProbeOutcome = { id: 'go-duration', present: false, detail: 'not-wired' }

function probeWith(outcomes: readonly ProbeOutcome[]) {
  return async (ids: readonly string[]) => outcomes.filter((o) => ids.includes(o.id))
}

/** 計數用的探測：驗證「不沿用摘要」時要能看出它真的重跑了，且只跑一次。 */
function countingProbe(outcomes: readonly ProbeOutcome[]) {
  const probe = probeWith(outcomes)
  let calls = 0
  return {
    get calls() {
      return calls
    },
    run: async (ids: readonly string[]) => {
      calls++
      return probe(ids)
    },
  }
}

/** 攔截 console.error，驗證「阻斷才輸出」這個刻意的設計。 */
async function captureErrors(fn: () => Promise<void>): Promise<string> {
  const captured: string[] = []
  const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '))
  })
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return captured.join('\n')
}

describe('runDiagnostics', () => {
  test('涵蓋全部設定檔並記錄檢查時間', async () => {
    const session = createDiagnosticsSession()
    const summary = await session.runDiagnostics({ probe: probeWith([ffmpegPresent]) })

    expect(summary.profiles.map((p) => p.profile)).toEqual([
      'crawl',
      'audiobook',
      'm4b',
      'youtube',
      'backup',
    ])
    expect(summary.checkedAt).toBeInstanceOf(Date)
  })

  test('執行後成為最近一次摘要，重跑則取代它', async () => {
    const session = createDiagnosticsSession()
    expect(session.getLastSummary()).toBeUndefined()

    const first = await session.runDiagnostics({ probe: probeWith([ffmpegPresent]) })
    expect(session.getLastSummary()).toBe(first)

    const second = await session.runDiagnostics({ probe: probeWith([ffmpegMissing]) })
    expect(session.getLastSummary()).toBe(second)
  })

  test('各工作階段的摘要互不影響', async () => {
    const a = createDiagnosticsSession()
    const b = createDiagnosticsSession()

    await a.runDiagnostics({ probe: probeWith([ffmpegPresent]) })

    expect(a.getLastSummary()).toBeDefined()
    expect(b.getLastSummary()).toBeUndefined()
  })
})

describe('formatSummary', () => {
  async function summaryWith(outcomes: readonly ProbeOutcome[]): Promise<DiagnosticsSummary> {
    return createDiagnosticsSession().runDiagnostics({ probe: probeWith(outcomes) })
  }

  test('尚未檢查時說明沒有摘要', () => {
    expect(formatSummary(undefined)).toContain('尚未')
  })

  test('列出每個設定檔的可進行判定', async () => {
    const text = formatSummary(await summaryWith([ffmpegMissing]))

    expect(text).toContain('crawl')
    expect(text).toContain('m4b')
    expect(text).toContain('不可進行')
  })

  test('標示摘要的產生時間，讓使用者知道它可能已過期', async () => {
    const summary = await summaryWith([ffmpegPresent])

    expect(formatSummary(summary, new Date(summary.checkedAt.getTime() + 5 * 60_000))).toContain(
      '5 分鐘前'
    )
    expect(formatSummary(summary, new Date(summary.checkedAt.getTime() + 3 * 3600_000))).toContain(
      '3 小時前'
    )
  })

  test('阻斷項附上修復資訊，與 CLI 一致', async () => {
    expect(formatSummary(await summaryWith([ffmpegMissing]))).toContain('brew install ffmpeg')
  })

  test('警告也展開——這是啟動前唯一能看到降級說明的地方', async () => {
    const text = formatSummary(await summaryWith([ffmpegPresent, durationNotWired]))

    expect(text).toContain('沒有任何流程接上')
  })
})

describe('ensureCanLaunch', () => {
  test('可進行時放行', async () => {
    const session = createDiagnosticsSession()
    const result = await session.ensureCanLaunch('m4b', { probe: probeWith([ffmpegPresent]) })

    expect(result.canLaunch).toBe(true)
  })

  test('存在阻斷項時不放行，並說明原因', async () => {
    const session = createDiagnosticsSession()
    const result = await session.ensureCanLaunch('m4b', { probe: probeWith([ffmpegMissing]) })

    expect(result.canLaunch).toBe(false)
    expect(result.report).toContain('ffmpeg')
    expect(result.report).toContain('不啟動')
  })

  test('即時重新探測，不沿用最近一次摘要，且只探測一次', async () => {
    const session = createDiagnosticsSession()
    await session.runDiagnostics({ probe: probeWith([ffmpegPresent]) })
    expect(session.getLastSummary()!.profiles.find((p) => p.profile === 'm4b')!.canProceed).toBe(
      true
    )

    const probe = countingProbe([ffmpegMissing])
    const result = await session.ensureCanLaunch('m4b', { probe: probe.run })

    expect(probe.calls).toBe(1)
    expect(result.canLaunch).toBe(false)
  })

  test('即時判定會更新摘要，摘要不會與剛剛的阻斷訊息矛盾', async () => {
    const session = createDiagnosticsSession()
    await session.runDiagnostics({ probe: probeWith([ffmpegPresent]) })

    await session.ensureCanLaunch('m4b', { probe: probeWith([ffmpegMissing]) })

    const m4b = session.getLastSummary()!.profiles.find((p) => p.profile === 'm4b')!
    expect(m4b.canProceed).toBe(false)
  })
})

describe('guardLaunch', () => {
  test('阻斷時回報不放行並印出原因', async () => {
    const session = createDiagnosticsSession()
    let allowed: boolean | undefined

    const errors = await captureErrors(async () => {
      allowed = await session.guardLaunch('m4b', { probe: probeWith([ffmpegMissing]) })
    })

    expect(allowed).toBe(false)
    expect(errors).toContain('ffmpeg')
    expect(errors).toContain('不啟動')
  })

  test('放行時不輸出——警告由子程序印一次，這裡再印就是重複', async () => {
    const session = createDiagnosticsSession()
    let allowed: boolean | undefined

    const errors = await captureErrors(async () => {
      allowed = await session.guardLaunch('m4b', {
        probe: probeWith([ffmpegPresent, durationNotWired]),
      })
    })

    expect(allowed).toBe(true)
    expect(errors).toBe('')
  })
})
