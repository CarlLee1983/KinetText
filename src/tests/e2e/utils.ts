/**
 * E2E test utilities
 * Shared helper functions for validating audio files and cleaning up test artifacts.
 */

import { stat, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { createLogger } from '../../core/utils/logger'

const logger = createLogger('e2e-utils')

/**
 * Verify that a file exists at the given path and is non-empty.
 *
 * @param filePath - Absolute path to the file
 * @returns true if the file exists and has size > 0
 */
export async function fileExistsAndNonEmpty(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath)
    return info.isFile() && info.size > 0
  } catch {
    return false
  }
}

/**
 * Verify an MP3 file by checking:
 * 1. File exists and is non-empty
 * 2. music-metadata can parse it
 * 3. Codec contains 'MPEG' (MP3 identifier)
 *
 * @param filePath - Absolute path to the MP3 file
 * @throws Error with description if any check fails
 */
export async function verifyMP3File(filePath: string): Promise<void> {
  const exists = await fileExistsAndNonEmpty(filePath)
  if (!exists) {
    throw new Error(`MP3 file not found or empty: ${filePath}`)
  }

  const meta = await parseFile(filePath)
  const codec = meta.format.codec ?? ''
  if (!codec.toUpperCase().includes('MPEG')) {
    throw new Error(
      `Expected MPEG codec for MP3 file at ${filePath}, got: ${codec}`
    )
  }

  logger.debug({ filePath, codec }, 'MP3 verification passed')
}

/**
 * Extract the duration of an audio file in seconds using music-metadata.
 *
 * @param filePath - Absolute path to the audio file
 * @returns Duration in seconds (0 if metadata is unavailable)
 */
export async function getMp3Duration(filePath: string): Promise<number> {
  const meta = await parseFile(filePath)
  const duration = meta.format.duration ?? 0
  logger.debug({ filePath, duration }, 'Duration extracted')
  return duration
}

/**
 * Remove all files and subdirectories inside a directory.
 * The directory itself is preserved.
 * Silently ignores individual deletion errors.
 *
 * @param dirPath - Absolute path to the directory to clean
 */
export async function cleanupTestFiles(dirPath: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(dirPath)
  } catch {
    // Directory does not exist — nothing to clean
    return
  }

  await Promise.all(
    entries.map(async (entry) => {
      try {
        await rm(join(dirPath, entry), { recursive: true, force: true })
      } catch (err) {
        logger.warn({ entry, err }, 'Failed to remove test file during cleanup')
      }
    })
  )
  logger.debug({ dirPath, count: entries.length }, 'Test directory cleaned')
}

/**
 * Assert that actual duration is within a given percentage of expected.
 *
 * @param actual   - Measured duration in seconds
 * @param expected - Expected duration in seconds
 * @param maxPct   - Maximum allowed deviation as percentage (default: 1)
 * @throws Error if deviation exceeds maxPct
 */
export function assertDurationWithinPercent(
  actual: number,
  expected: number,
  maxPct: number = 1
): void {
  if (expected === 0) return
  const pct = Math.abs(actual - expected) / expected * 100
  if (pct > maxPct) {
    throw new Error(
      `Duration deviation ${pct.toFixed(2)}% exceeds ${maxPct}% ` +
      `(actual=${actual.toFixed(3)}s, expected=${expected.toFixed(3)}s)`
    )
  }
}
