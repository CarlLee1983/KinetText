import { resolve } from 'node:path'

const GO_BINARY_FILENAMES = {
  audio: 'kinetitext-audio',
  duration: 'kinetitext-duration',
  mp4convert: 'kinetitext-mp4convert',
} as const

export type GoBinary = keyof typeof GO_BINARY_FILENAMES

/** The sibling Go repository used by local development and integration tests. */
const DEFAULT_GO_PROJECT_ROOT = resolve(
  import.meta.dir,
  '../../../kinetitext-go'
)

/**
 * Resolves one of the supported Go executables from a Go project root.
 *
 * Callers that accept a user-supplied binary path should retain that override;
 * this function only provides the shared local-development default.
 */
export function resolveGoBinaryPath(
  binary: GoBinary,
  goProjectRoot = DEFAULT_GO_PROJECT_ROOT
): string {
  return resolve(goProjectRoot, 'bin', GO_BINARY_FILENAMES[binary])
}
