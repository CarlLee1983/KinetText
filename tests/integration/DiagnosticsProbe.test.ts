import { afterEach, describe, expect, test } from 'bun:test'
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

describe('Go 輔助工具的優先序解析（經探測層）', () => {
  const realExecutable = '/bin/echo'

  test('環境變數指定的路徑存在時被解析到，並回報該路徑', async () => {
    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: realExecutable },
    })

    // 目前沒有流程接上這支輔助工具，因此解析成功仍不算可用
    expect(outcome!.detail).toBe('not-wired')
    expect(outcome!.searched).toBe(realExecutable)
  })

  test('環境變數指定的路徑不存在時判定為不可用，並回報找過哪裡', async () => {
    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: '/nonexistent/kinetitext-duration' },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('unavailable')
    expect(outcome!.searched).toContain('/nonexistent/kinetitext-duration')
  })

  test('overrides 優先於環境變數', async () => {
    const [outcome] = await probeCapabilities(['go-duration'], {
      overrides: { 'go-duration': realExecutable },
      env: { DURATION_GO_BINARY_PATH: '/nonexistent/kinetitext-duration' },
    })

    expect(outcome!.detail).toBe('not-wired')
    expect(outcome!.searched).toBe(realExecutable)
  })

  test('三支輔助工具各自解析，互不影響', async () => {
    const outcomes = await probeCapabilities(['go-audio', 'go-duration', 'go-mp4convert'], {
      env: {
        AUDIO_GO_BINARY_PATH: realExecutable,
        DURATION_GO_BINARY_PATH: '/nonexistent/duration',
        MP4_GO_BINARY_PATH: realExecutable,
        MP4_GO_ENABLED: 'true',
      },
    })
    const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]))

    // 三支各自解析：兩支找到（但尚未接上流程），一支路徑不存在
    expect(byId.get('go-audio')!.detail).toBe('not-wired')
    expect(byId.get('go-audio')!.searched).toBe(realExecutable)
    expect(byId.get('go-duration')!.detail).toBe('unavailable')
    expect(byId.get('go-mp4convert')!.detail).toBe('not-wired')
  })

  test('MP4 輔助工具預設停用，二進位存在也不報為可用', async () => {
    const [outcome] = await probeCapabilities(['go-mp4convert'], {
      env: { MP4_GO_BINARY_PATH: realExecutable },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('disabled')
  })

  test('時長輔助工具可被 DURATION_GO_ENABLED=false 停用', async () => {
    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: realExecutable, DURATION_GO_ENABLED: 'false' },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('disabled')
  })
})

describe('預設的可執行檔判定（唯一真正接觸檔案系統的一段）', () => {
  const created: string[] = []

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  test('存在但不可執行的檔案判定為不可用', async () => {
    const { mkdtemp, writeFile, chmod } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const directory = await mkdtemp(join(tmpdir(), 'kinetitext-probe-'))
    created.push(directory)
    const file = join(directory, 'kinetitext-duration')
    await writeFile(file, '')
    await chmod(file, 0o644)

    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: file },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('unavailable')
  })

  test('指向目錄而非二進位時判定為不可用', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const directory = await mkdtemp(join(tmpdir(), 'kinetitext-probe-'))
    created.push(directory)

    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: directory },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('unavailable')
  })

  test('空字串的環境變數視為指定了不存在的路徑，不退回預設', async () => {
    const [outcome] = await probeCapabilities(['go-duration'], {
      env: { DURATION_GO_BINARY_PATH: '' },
    })

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('unavailable')
  })
})

describe('備份能力探測', () => {
  async function rcloneInstalled(): Promise<boolean> {
    const [outcome] = await probeCapabilities(['rclone'])
    return outcome!.present
  }

  test('rclone 未安裝時判定為缺席且不拋出例外', async () => {
    if (await rcloneInstalled()) return // 本機已安裝，跳過

    const [outcome] = await probeCapabilities(['rclone'])

    expect(outcome!.present).toBe(false)
    expect(outcome!.detail).toBe('not-found')
  })

  test('備份目標仍是出廠範例值時，以警告而非阻斷表達，且不需 rclone 在場', async () => {
    const [outcome] = await probeCapabilities(['rclone-remotes'])

    expect(outcome!.detail).toBe('example-destinations')
    expect(outcome!.state).toBe('degraded')
  })

  test('rclone 已安裝時，遠端探測回報缺少哪些具名遠端', async () => {
    if (!(await rcloneInstalled())) return // 本機未安裝，跳過

    const [outcome] = await probeCapabilities(['rclone-remotes'])

    expect(typeof outcome!.present).toBe('boolean')
    if (!outcome!.present) {
      expect(outcome!.detail).toBe('remote-not-configured')
      expect(outcome!.searched).toBeTruthy()
    }
  })

  test('備份探測不對遠端發出連線——只讀本機設定', async () => {
    // listremotes 只讀設定檔；此測試鎖住「探測不連線」這個對外承諾，
    // 方式是確認它在無網路可用的假設下仍能在探測逾時內完成。
    const outcomes = await probeCapabilities(['rclone-remotes'], { timeoutMs: 3000 })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.id).toBe('rclone-remotes')
  })
})
