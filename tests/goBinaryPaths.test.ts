import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveGoBinary, resolveGoBinaryPath } from '../src/config/goBinaryPaths'
import { AudioConvertGoConfigSchema } from '../src/config/AudioConvertGoConfig'
import { createAudioConvertGoConfig } from '../src/config/AudioConvertGoConfig'
import { DurationGoConfigSchema } from '../src/config/DurationGoConfig'
import { createDurationGoConfig } from '../src/config/DurationGoConfig'
import { MP4ConvertGoConfigSchema } from '../src/config/MP4ConvertGoConfig'
import { createMP4ConvertGoConfig } from '../src/config/MP4ConvertGoConfig'

const temporaryDirectories: string[] = []
const goBinaryEnvironment = [
  'AUDIO_GO_BINARY_PATH',
  'DURATION_GO_BINARY_PATH',
  'MP4_GO_BINARY_PATH',
] as const
const originalEnvironment = new Map(
  goBinaryEnvironment.map((key) => [key, process.env[key]])
)

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
  for (const key of goBinaryEnvironment) {
    const originalValue = originalEnvironment.get(key)
    if (originalValue === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalValue
    }
  }
})

describe('Go binary paths', () => {
  test('resolves every supported binary from a supplied Go project root', () => {
    const goProjectRoot = '/workspace/kinetitext-go'

    expect(resolveGoBinaryPath('audio', goProjectRoot)).toBe(
      '/workspace/kinetitext-go/bin/kinetitext-audio'
    )
    expect(resolveGoBinaryPath('duration', goProjectRoot)).toBe(
      '/workspace/kinetitext-go/bin/kinetitext-duration'
    )
    expect(resolveGoBinaryPath('mp4convert', goProjectRoot)).toBe(
      '/workspace/kinetitext-go/bin/kinetitext-mp4convert'
    )
  })

  test('distinguishes an existing binary from a missing sibling binary', async () => {
    const goProjectRoot = await mkdtemp(join(tmpdir(), 'kineti-go-paths-'))
    temporaryDirectories.push(goProjectRoot)
    const audioBinary = resolveGoBinaryPath('audio', goProjectRoot)

    await mkdir(join(goProjectRoot, 'bin'))
    await Bun.write(audioBinary, '')

    expect(await Bun.file(audioBinary).exists()).toBe(true)
    expect(
      await Bun.file(resolveGoBinaryPath('duration', goProjectRoot)).exists()
    ).toBe(false)
  })

  test('keeps every Go configuration default aligned with the shared resolver', () => {
    expect(AudioConvertGoConfigSchema.parse({}).goBinaryPath).toBe(
      resolveGoBinaryPath('audio')
    )
    expect(DurationGoConfigSchema.parse({}).goBinaryPath).toBe(
      resolveGoBinaryPath('duration')
    )
    expect(MP4ConvertGoConfigSchema.parse({}).goBinaryPath).toBe(
      resolveGoBinaryPath('mp4convert')
    )
  })

  test('preserves environment overrides and explicit-path precedence', () => {
    process.env.AUDIO_GO_BINARY_PATH = '/environment/audio'
    process.env.DURATION_GO_BINARY_PATH = '/environment/duration'
    process.env.MP4_GO_BINARY_PATH = '/environment/mp4convert'

    expect(createAudioConvertGoConfig().goBinaryPath).toBe('/environment/audio')
    expect(createDurationGoConfig().goBinaryPath).toBe('/environment/duration')
    expect(createMP4ConvertGoConfig().goBinaryPath).toBe('/environment/mp4convert')
    expect(
      createAudioConvertGoConfig({ goBinaryPath: '/override/audio' }).goBinaryPath
    ).toBe('/override/audio')
  })
})

describe('resolveGoBinary 優先序鏈', () => {
  const allExist = () => true
  const noneExist = () => false

  test('明確傳入的路徑優先於環境變數與預設', () => {
    const resolution = resolveGoBinary('duration', {
      override: '/explicit/duration',
      env: { DURATION_GO_BINARY_PATH: '/from/env' },
      exists: allExist,
    })

    expect(resolution.source).toBe('override')
    expect(resolution.path).toBe('/explicit/duration')
  })

  test('沒有明確路徑時採用環境變數', () => {
    const resolution = resolveGoBinary('duration', {
      env: { DURATION_GO_BINARY_PATH: '/from/env' },
      exists: allExist,
    })

    expect(resolution.source).toBe('env')
    expect(resolution.path).toBe('/from/env')
  })

  test('三支二進位各自讀自己的環境變數', () => {
    const env = {
      AUDIO_GO_BINARY_PATH: '/audio',
      DURATION_GO_BINARY_PATH: '/duration',
      MP4_GO_BINARY_PATH: '/mp4',
    }

    expect(resolveGoBinary('audio', { env, exists: allExist }).path).toBe('/audio')
    expect(resolveGoBinary('duration', { env, exists: allExist }).path).toBe('/duration')
    expect(resolveGoBinary('mp4convert', { env, exists: allExist }).path).toBe('/mp4')
  })

  test('皆未指定時退回相鄰 repo 的開發預設', () => {
    const resolution = resolveGoBinary('duration', { env: {}, exists: allExist })

    expect(resolution.source).toBe('default')
    expect(resolution.path).toContain('kinetitext-duration')
  })

  test('候選路徑都不存在時判定為不可用', () => {
    const resolution = resolveGoBinary('duration', { env: {}, exists: noneExist })

    expect(resolution.source).toBe('unavailable')
    expect(resolution.path).toBeUndefined()
  })

  test('較高順位的路徑不存在時，不會靜默退回較低順位', () => {
    const resolution = resolveGoBinary('duration', {
      override: '/explicit/missing',
      env: { DURATION_GO_BINARY_PATH: '/from/env' },
      exists: (path: string) => path === '/from/env',
    })

    expect(resolution.source).toBe('unavailable')
    expect(resolution.attempted).toEqual(['/explicit/missing'])
  })

  test('環境變數指定的路徑不存在時同樣不退回預設', () => {
    const resolution = resolveGoBinary('duration', {
      env: { DURATION_GO_BINARY_PATH: '/from/env' },
      exists: () => false,
    })

    expect(resolution.source).toBe('unavailable')
    expect(resolution.attempted).toEqual(['/from/env'])
  })
})
