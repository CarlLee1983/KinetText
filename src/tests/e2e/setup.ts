/**
 * E2E test environment setup
 * Initialises shared temporary directory and validates FFmpeg availability.
 * Import at the top of every E2E test suite.
 */

import { beforeAll, afterAll } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { createLogger } from '../../core/utils/logger'

const logger = createLogger('e2e-setup')

/** Shared temp directory for all E2E test files (populated in beforeAll) */
export let e2eRootDir = ''

/**
 * Check that FFmpeg is installed and accessible.
 * Throws with install instructions if missing.
 */
async function checkFfmpeg(): Promise<void> {
  const result = await $`ffmpeg -version`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(
      'FFmpeg not found in PATH. Install via: brew install ffmpeg'
    )
  }
  logger.info('FFmpeg availability confirmed')
}

/**
 * Create an isolated temporary root directory for the E2E suite.
 * Stored in the exported `e2eRootDir` variable.
 */
async function createTempRoot(): Promise<void> {
  e2eRootDir = await mkdtemp(join(tmpdir(), 'kinetitext-e2e-'))
  logger.info({ dir: e2eRootDir }, 'E2E temp directory created')
}

/**
 * Remove all files created under e2eRootDir.
 */
async function cleanupTempRoot(): Promise<void> {
  if (e2eRootDir) {
    await rm(e2eRootDir, { recursive: true, force: true })
    logger.info({ dir: e2eRootDir }, 'E2E temp directory removed')
    e2eRootDir = ''
  }
}

/**
 * Register global E2E lifecycle hooks.
 * Call once at the top of each E2E test file.
 *
 * @example
 * ```ts
 * import { registerE2EHooks } from './setup'
 * registerE2EHooks()
 * ```
 */
export function registerE2EHooks(): void {
  beforeAll(async () => {
    await checkFfmpeg()
    await createTempRoot()
  }, 30000)

  afterAll(async () => {
    await cleanupTempRoot()
  }, 15000)
}
