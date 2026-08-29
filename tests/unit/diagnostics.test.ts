import { describe, expect, test } from 'bun:test'

// 固定指紋金鑰，讓測試不依賴（也不產生）本機金鑰檔。
process.env.KINETITEXT_FINGERPRINT_KEY ??= 'test-fingerprint-key'
import {
  evaluateProfile,
  exitCodeFor,
  renderHuman,
  renderJson,
} from '../../src/diagnostics/evaluate'
import { secretFingerprint } from '../../src/diagnostics/secrets'
import { M4B_PROFILE, getProfile, PROFILE_NAMES } from '../../src/diagnostics/profiles'
import type { ProbeOutcome, WorkflowProfile } from '../../src/diagnostics/types'

const ffmpegPresent: ProbeOutcome = { id: 'ffmpeg', present: true, version: '7.1' }
const ffmpegMissing: ProbeOutcome = { id: 'ffmpeg', present: false }

/** 只在本檔使用的測試用設定檔：一個阻斷項、一個可降級項。 */
const twoCapabilityProfile: WorkflowProfile = {
  name: 'test-profile',
  capabilities: [
    {
      id: 'ffmpeg',
      label: 'ffmpeg',
      whenMissing: 'blocked',
      remedy: '請安裝 ffmpeg 後重試',
    },
    {
      id: 'accelerator',
      label: '加速器',
      whenMissing: 'degraded',
      fallback: '改以既有實作執行，較慢但結果相同',
      remedy: '安裝加速器可縮短處理時間',
    },
  ],
}

describe('evaluateProfile', () => {
  test('探測到能力時判定為可用，且流程可進行', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [ffmpegPresent])

    expect(verdict.profile).toBe('m4b')
    expect(verdict.canProceed).toBe(true)
    expect(verdict.capabilities[0]!.state).toBe('available')
    expect(verdict.capabilities[0]!.version).toBe('7.1')
  })

  test('缺少無替代能力的項目時判定為阻斷，流程不可進行', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [ffmpegMissing])

    expect(verdict.canProceed).toBe(false)
    expect(verdict.capabilities[0]!.state).toBe('blocked')
    expect(verdict.capabilities[0]!.message).toContain('請安裝 ffmpeg')
  })

  test('缺少具替代能力的項目時判定為降級，流程仍可進行', () => {
    const verdict = evaluateProfile(twoCapabilityProfile, [
      ffmpegPresent,
      { id: 'accelerator', present: false },
    ])

    const accelerator = verdict.capabilities.find((c) => c.id === 'accelerator')!
    expect(accelerator.state).toBe('degraded')
    expect(accelerator.message).toContain('較慢但結果相同')
    expect(verdict.canProceed).toBe(true)
  })

  test('阻斷與降級同時存在時，阻斷勝出', () => {
    const verdict = evaluateProfile(twoCapabilityProfile, [
      ffmpegMissing,
      { id: 'accelerator', present: false },
    ])

    expect(verdict.canProceed).toBe(false)
    expect(verdict.blocking.map((c) => c.id)).toEqual(['ffmpeg'])
    expect(verdict.warnings.map((c) => c.id)).toEqual(['accelerator'])
  })

  test('沒有探測結果的能力視為缺席，而非略過', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [])

    expect(verdict.capabilities).toHaveLength(1)
    expect(verdict.capabilities[0]!.state).toBe('blocked')
  })

  test('逾時的探測計為缺席，並在訊息中說明', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [
      { id: 'ffmpeg', present: false, detail: 'timeout' },
    ])

    expect(verdict.capabilities[0]!.state).toBe('blocked')
    expect(verdict.capabilities[0]!.detail).toBe('timeout')
  })

  test('逾時不建議使用者去安裝工具——工具可能就在那裡', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [
      { id: 'ffmpeg', present: false, detail: 'timeout' },
    ])

    expect(verdict.capabilities[0]!.message).not.toContain('brew install')
    expect(verdict.capabilities[0]!.message).toContain('逾時')
  })

  test('取消的探測說明本次結果不代表不可用', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [
      { id: 'ffmpeg', present: false, detail: 'cancelled' },
    ])

    expect(verdict.capabilities[0]!.message).not.toContain('brew install')
    expect(verdict.capabilities[0]!.message).toContain('取消')
  })

  test('未註冊探測方式時說明是內部設定缺漏，而非使用者環境問題', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [
      { id: 'ffmpeg', present: false, detail: 'no-probe' },
    ])

    expect(verdict.capabilities[0]!.message).toContain('內部設定缺漏')
  })

  test('探測失敗的錯誤輸出併入訊息，便於排查', () => {
    const verdict = evaluateProfile(M4B_PROFILE, [
      { id: 'ffmpeg', present: false, detail: 'exit-1', error: 'permission denied' },
    ])

    expect(verdict.capabilities[0]!.message).toContain('permission denied')
  })

  test('評估是純函式：不修改傳入的探測結果', () => {
    const outcomes: ProbeOutcome[] = [{ id: 'ffmpeg', present: true, version: '7.1' }]
    const snapshot = structuredClone(outcomes)

    evaluateProfile(M4B_PROFILE, outcomes)

    expect(outcomes).toEqual(snapshot)
  })
})

describe('exitCodeFor', () => {
  test('全部可進行時為 0', () => {
    expect(exitCodeFor([evaluateProfile(M4B_PROFILE, [ffmpegPresent])])).toBe(0)
  })

  test('任一設定檔存在阻斷項時為非零', () => {
    expect(exitCodeFor([evaluateProfile(M4B_PROFILE, [ffmpegMissing])])).not.toBe(0)
  })
})

describe('renderJson', () => {
  test('輸出結構穩定，含設定檔、可進行判定與各能力狀態', () => {
    const parsed = JSON.parse(renderJson([evaluateProfile(M4B_PROFILE, [ffmpegPresent])]))

    expect(parsed.profiles[0].profile).toBe('m4b')
    expect(parsed.profiles[0].canProceed).toBe(true)
    expect(parsed.profiles[0].capabilities[0].id).toBe('ffmpeg')
    expect(parsed.profiles[0].capabilities[0].state).toBe('available')
    expect(parsed.canProceed).toBe(true)
  })

  test('阻斷項反映在頂層 canProceed', () => {
    const parsed = JSON.parse(renderJson([evaluateProfile(M4B_PROFILE, [ffmpegMissing])]))
    expect(parsed.canProceed).toBe(false)
  })

  test('三態在 JSON 輸出中都可區分', () => {
    const blocked = JSON.parse(renderJson([evaluateProfile(M4B_PROFILE, [ffmpegMissing])]))
    expect(blocked.profiles[0].capabilities[0].state).toBe('blocked')
    expect(blocked.profiles[0].blocking).toEqual(['ffmpeg'])

    const degraded = JSON.parse(
      renderJson([
        evaluateProfile(twoCapabilityProfile, [
          ffmpegPresent,
          { id: 'accelerator', present: false },
        ]),
      ])
    )
    const states = degraded.profiles[0].capabilities.map((c: { state: string }) => c.state)
    expect(states).toEqual(['available', 'degraded'])
    expect(degraded.profiles[0].warnings).toEqual(['accelerator'])
  })

  test('缺值輸出 null 而非省略鍵，且帶 schemaVersion', () => {
    const parsed = JSON.parse(renderJson([evaluateProfile(M4B_PROFILE, [ffmpegMissing])]))
    const capability = parsed.profiles[0].capabilities[0]

    expect(parsed.schemaVersion).toBe(1)
    expect(Object.keys(capability)).toContain('version')
    expect(capability.version).toBeNull()
  })
})

describe('renderHuman', () => {
  test('阻斷與警告在輸出中可區分', () => {
    const text = renderHuman([
      evaluateProfile(twoCapabilityProfile, [ffmpegMissing, { id: 'accelerator', present: false }]),
    ])

    expect(text).toContain('阻斷')
    expect(text).toContain('警告')
  })

  test('阻斷項附帶修復資訊', () => {
    const text = renderHuman([evaluateProfile(M4B_PROFILE, [ffmpegMissing])])
    expect(text).toContain('請安裝 ffmpeg 後重試')
  })
})

describe('祕密遮蔽', () => {
  test('祕密設定指紋不可逆且不含原始值', () => {
    const secret = 'super-secret-token-value'
    const fingerprint = secretFingerprint(secret)

    expect(fingerprint).not.toContain(secret)
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(secretFingerprint(secret)).toBe(fingerprint)
    expect(secretFingerprint('another-value')).not.toBe(fingerprint)
  })

  test('未設定的祕密有穩定的表示，且不等同任何已設定值', () => {
    expect(secretFingerprint(undefined)).toBe(secretFingerprint(undefined))
    expect(secretFingerprint(undefined)).not.toBe(secretFingerprint(''))
  })

  test('兩種輸出都不包含原始祕密值', () => {
    const secret = 'super-secret-token-value'
    const profile: WorkflowProfile = {
      ...twoCapabilityProfile,
      secretNames: ['EXAMPLE_TOKEN'],
    }
    const verdict = evaluateProfile(
      profile,
      [ffmpegPresent, { id: 'accelerator', present: true }],
      { EXAMPLE_TOKEN: secret }
    )

    expect(verdict.secretFingerprints[0]!.name).toBe('EXAMPLE_TOKEN')
    expect(renderJson([verdict])).not.toContain(secret)
    expect(renderHuman([verdict])).not.toContain(secret)
  })
})

describe('profiles', () => {
  test('m4b 設定檔可依名稱取得', () => {
    expect(getProfile('m4b')).toBe(M4B_PROFILE)
  })

  test('未知設定檔名稱回傳 undefined', () => {
    expect(getProfile('does-not-exist')).toBeUndefined()
  })

  test('已註冊的設定檔名稱可列舉', () => {
    expect(PROFILE_NAMES).toContain('m4b')
  })
})
