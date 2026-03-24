/**
 * E2E test fixtures
 * Provides reusable sample audio files for E2E test suites.
 * All generated files live inside the e2eRootDir managed by setup.ts.
 */

import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from 'bun'
import { createLogger } from '../../core/utils/logger'
import { e2eRootDir } from './setup'

const logger = createLogger('e2e-fixtures')

/** Duration in seconds used for lightweight test audio files */
const SAMPLE_DURATION_S = 5

/**
 * Generate a single silent WAV file using FFmpeg lavfi source.
 *
 * @param dir   - Output directory
 * @param name  - File basename (without extension)
 * @param secs  - Duration in seconds (default: 5)
 * @returns Absolute path to the generated WAV file
 */
export async function generateWAV(
  dir: string,
  name: string,
  secs: number = SAMPLE_DURATION_S
): Promise<string> {
  const filePath = join(dir, `${name}.wav`)
  const result = await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${secs} ${filePath}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to generate WAV fixture: ${filePath}`)
  }
  logger.debug({ filePath }, 'Generated WAV fixture')
  return filePath
}

/**
 * Generate a single silent MP3 file using FFmpeg lavfi source.
 *
 * @param dir   - Output directory
 * @param name  - File basename (without extension)
 * @param secs  - Duration in seconds (default: 5)
 * @returns Absolute path to the generated MP3 file
 */
export async function generateMP3(
  dir: string,
  name: string,
  secs: number = SAMPLE_DURATION_S
): Promise<string> {
  const filePath = join(dir, `${name}.mp3`)
  const result = await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${secs} -q:a 9 ${filePath}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to generate MP3 fixture: ${filePath}`)
  }
  logger.debug({ filePath }, 'Generated MP3 fixture')
  return filePath
}

/**
 * Generate a suite of source audio files in four formats (WAV, AAC, OGG, FLAC).
 * Used for multi-format conversion E2E tests.
 *
 * @param dir - Output directory for the generated files
 * @returns Object mapping format name to absolute path
 */
export async function generateMultiFormatSamples(
  dir: string
): Promise<Record<string, string>> {
  const wav = join(dir, 'sample.wav')
  const aac = join(dir, 'sample.aac')
  const ogg = join(dir, 'sample.ogg')
  const flac = join(dir, 'sample.flac')

  await Promise.all([
    $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${SAMPLE_DURATION_S} ${wav}`.quiet().nothrow(),
    $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${SAMPLE_DURATION_S} -codec:a aac ${aac}`.quiet().nothrow(),
    $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${SAMPLE_DURATION_S} -codec:a libopus ${ogg}`.quiet().nothrow(),
    $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${SAMPLE_DURATION_S} ${flac}`.quiet().nothrow(),
  ])

  logger.info({ dir }, 'Generated multi-format fixture samples (WAV, AAC, OGG, FLAC)')
  return { wav, aac, ogg, flac }
}

/**
 * Generate a set of 10 silent MP3 files for batch/merge tests.
 * Each file is 3 seconds long to keep tests fast.
 *
 * @param subDir - Subdirectory name inside e2eRootDir (created automatically)
 * @returns Array of absolute paths to the 10 MP3 files
 */
export async function getSample10MP3s(subDir: string = 'mp3-batch'): Promise<string[]> {
  const dir = await mkdtemp(join(e2eRootDir, `${subDir}-`))
  const FILE_COUNT = 10
  const FILE_DURATION = 3

  const paths: string[] = []
  for (let i = 1; i <= FILE_COUNT; i++) {
    const name = `sample_${i.toString().padStart(3, '0')}`
    const p = await generateMP3(dir, name, FILE_DURATION)
    paths.push(p)
  }

  logger.info({ dir, count: FILE_COUNT }, `Generated ${FILE_COUNT} MP3 fixtures`)
  return paths
}

/**
 * Create a fresh subdirectory inside e2eRootDir.
 * Use this to isolate output files between test scenarios.
 *
 * @param label - Descriptive label for the subdirectory (used in path)
 * @returns Absolute path to the created directory
 */
export async function createTestSubDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(e2eRootDir, `${label}-`))
  return dir
}
