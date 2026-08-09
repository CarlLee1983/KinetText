import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveGoBinaryPath } from '../src/config/goBinaryPaths'
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
