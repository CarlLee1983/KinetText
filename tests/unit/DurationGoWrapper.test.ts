import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DurationGoWrapper } from '../../src/core/services/DurationGoWrapper'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('DurationGoWrapper', () => {
  test('terminates a Go subprocess when the configured timeout expires', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kineti-duration-timeout-'))
    temporaryDirectories.push(directory)
    const helperPath = join(directory, 'slow-duration')

    await Bun.write(helperPath, '#!/bin/sh\nexec sleep 1\n')
    await chmod(helperPath, 0o755)

    DurationGoWrapper.init(helperPath, {
      enabled: true,
      goBinaryPath: helperPath,
      timeout: 50,
      concurrency: 1,
      perFileTimeout: 50,
    })

    const startedAt = performance.now()
    await expect(
      DurationGoWrapper.readMetadata(['/tmp/input.mp3'])
    ).rejects.toThrow('Duration Go process timed out after 50ms')
    expect(performance.now() - startedAt).toBeLessThan(500)
  })
})
