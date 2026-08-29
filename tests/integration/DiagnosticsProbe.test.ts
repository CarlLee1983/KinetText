import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { probeCapabilities, probeExecutable, probeProfile } from '../../src/diagnostics/probes'
import { M4B_PROFILE } from '../../src/diagnostics/profiles'

describe('probeExecutable', () => {
  test('存在的可執行檔回報為可用並帶版本', async () => {
    const outcome = await probeExecutable('echo-probe', 'echo', ['1.2.3'])

    expect(outcome.present).toBe(true)
    expect(outcome.version).toBe('1.2.3')
  })

  test('不存在的可執行檔回報為缺席，而非拋出例外', async () => {
    const outcome = await probeExecutable(
      'missing-probe',
      'kinetitext-definitely-not-installed'
    )

    expect(outcome.present).toBe(false)
    expect(outcome.detail).toBe('not-found')
  })

  test('逾時的探測計為缺席並標示 timeout', async () => {
    const outcome = await probeExecutable('slow-probe', 'sleep', ['5'], { timeoutMs: 50 })

    expect(outcome.present).toBe(false)
    expect(outcome.detail).toBe('timeout')
  })

  test('已取消的訊號讓探測立即回報 cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    const outcome = await probeExecutable('cancelled-probe', 'sleep', ['5'], {
      signal: controller.signal,
    })

    expect(outcome.present).toBe(false)
    expect(outcome.detail).toBe('cancelled')
  })

  test('進行中的探測可被取消', async () => {
    const controller = new AbortController()
    const pending = probeExecutable('cancelled-probe', 'sleep', ['5'], {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)

    const outcome = await pending
    expect(outcome.present).toBe(false)
    expect(outcome.detail).toBe('cancelled')
  })
})

describe('probeProfile', () => {
  test('回傳設定檔每一項能力的探測結果', async () => {
    const outcomes = await probeProfile(M4B_PROFILE)

    expect(outcomes).toHaveLength(M4B_PROFILE.capabilities.length)
    expect(outcomes[0]!.id).toBe('ffmpeg')
    expect(typeof outcomes[0]!.present).toBe('boolean')
  })
})

describe('探測解析優先序', () => {
  test('overrides 指定的路徑優先於探測器的預設命令', async () => {
    const outcome = await probeExecutable('ffmpeg', 'ffmpeg', ['9.9.9'], {
      overrides: { ffmpeg: 'echo' },
    })

    expect(outcome.present).toBe(true)
    expect(outcome.version).toBe('9.9.9')
  })

  test('抓不到版本樣式時回傳 undefined，而非把整行輸出當成版本', async () => {
    const outcome = await probeExecutable('echo-probe', 'echo', ['no version here'])

    expect(outcome.present).toBe(true)
    expect(outcome.version).toBeUndefined()
  })
})

describe('probeCapabilities', () => {
  test('重複的能力 id 只回傳一筆結果', async () => {
    const outcomes = await probeCapabilities(['ffmpeg', 'ffmpeg', 'ffmpeg'])

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.id).toBe('ffmpeg')
  })

  test('未註冊探測方式的能力標示為 no-probe', async () => {
    const outcomes = await probeCapabilities(['not-a-real-capability'])

    expect(outcomes[0]!.present).toBe(false)
    expect(outcomes[0]!.detail).toBe('no-probe')
  })
})

describe('doctor CLI 結束碼', () => {
  const bunDirectory = dirname(process.execPath)

  async function runDoctor(path: string): Promise<{ exitCode: number; stdout: string }> {
    const proc = Bun.spawn([process.execPath, 'scripts/doctor.ts', '--profile=m4b', '--json'], {
      env: { ...process.env, PATH: path },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    return { exitCode: await proc.exited, stdout }
  }

  test('存在阻斷項時以非零結束碼結束，且 JSON 完整寫出', async () => {
    const { exitCode, stdout } = await runDoctor(`${bunDirectory}:/usr/bin:/bin`)

    expect(exitCode).toBe(1)
    const parsed = JSON.parse(stdout)
    expect(parsed.canProceed).toBe(false)
    expect(parsed.profiles[0].capabilities[0].state).toBe('blocked')
  })

  test('全部可進行時以零結束碼結束', async () => {
    const available = await probeCapabilities(['ffmpeg'])
    if (!available[0]!.present) return // 本機沒有 ffmpeg，跳過

    const { exitCode, stdout } = await runDoctor(process.env.PATH ?? '')

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).canProceed).toBe(true)
  })
})
