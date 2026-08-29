import { beforeAll, afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * 啟動檢查的阻斷行為只能以子程序驗證：它以非零結束碼結束整個行程。
 * 這裡測的是對外承諾（結束碼與訊息），不是內部怎麼實作。
 */
let binWithoutTools: string

beforeAll(async () => {
  // 一個只有 bun、沒有 ffmpeg／rclone 的 PATH
  binWithoutTools = await mkdtemp(join(tmpdir(), 'kinetitext-nobin-'))
  await symlink(process.execPath, join(binWithoutTools, 'bun'))
})

afterAll(async () => {
  await rm(binWithoutTools, { recursive: true, force: true })
})

async function run(
  args: readonly string[],
  options: { readonly toolsAvailable: boolean } = { toolsAvailable: true }
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const path = options.toolsAvailable
    ? process.env.PATH
    : `${binWithoutTools}:/usr/bin:/bin`

  const proc = Bun.spawn([process.execPath, 'run', ...args], {
    env: { ...process.env, PATH: path },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode: await proc.exited, stdout, stderr }
}

describe('阻斷項使流程不啟動', () => {
  test('m4b 在 ffmpeg 缺席時不啟動，並以非零結束碼結束', async () => {
    const { exitCode, stderr } = await run(
      ['scripts/build_m4b.ts', '--title=不存在的書'],
      { toolsAvailable: false }
    )

    expect(exitCode).toBe(1)
    expect(stderr).toContain('流程不啟動')
    expect(stderr).toContain('ffmpeg')
  })

  test('阻斷項無法以旗標略過——未知旗標不會讓流程放行', async () => {
    for (const flag of ['--force', '--skip-checks', '--no-verify']) {
      const { exitCode, stderr } = await run(
        ['scripts/build_m4b.ts', '--title=不存在的書', flag],
        { toolsAvailable: false }
      )

      expect(exitCode).toBe(1)
      expect(stderr).toContain('流程不啟動')
    }
  })

  test('backup 在 rclone 缺席時不啟動', async () => {
    const { exitCode, stderr } = await run(['scripts/backup.ts'], {
      toolsAvailable: false,
    })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('流程不啟動')
    expect(stderr).toContain('rclone')
  })
})

describe('不執行外部工具的 dry-run 不受阻斷', () => {
  test('backup --dry-run 不檢查 rclone', async () => {
    const { exitCode, stderr, stdout } = await run(
      ['scripts/backup.ts', '--dry-run'],
      { toolsAvailable: false }
    )

    expect(stderr).not.toContain('流程不啟動')
    expect(stdout).toContain('Dry-run')
    expect(exitCode).toBe(0)
  })

  test('m4b --dry-run 不因缺少 ffmpeg 而被擋下', async () => {
    const { stderr } = await run(
      ['scripts/build_m4b.ts', '--title=不存在的書', '--dry-run'],
      { toolsAvailable: false }
    )

    // 這本書不存在，腳本仍會因自身原因失敗；重點是不該是啟動檢查擋的
    expect(stderr).not.toContain('流程不啟動')
  })
})

describe('說明不觸發檢查', () => {
  test('--help 在任何工具缺席時都能正常顯示', async () => {
    const { exitCode, stdout, stderr } = await run(['src/index.ts', '--help'], {
      toolsAvailable: false,
    })

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Usage')
    expect(stderr).not.toContain('流程不啟動')
  })
})
