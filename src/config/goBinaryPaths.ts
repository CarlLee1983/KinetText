import { statSync } from 'node:fs'
import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'

const GO_BINARY_FILENAMES = {
  audio: 'kinetitext-audio',
  duration: 'kinetitext-duration',
  mp4convert: 'kinetitext-mp4convert',
} as const

/** 每支輔助工具各自的環境變數，沿用既有 Go 設定模組已在使用的名稱。 */
const GO_BINARY_ENV_NAMES = {
  audio: 'AUDIO_GO_BINARY_PATH',
  duration: 'DURATION_GO_BINARY_PATH',
  mp4convert: 'MP4_GO_BINARY_PATH',
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

/** 解析結果的來源順位。unavailable 表示該順位的候選路徑不存在。 */
export type GoBinaryResolutionSource = 'override' | 'env' | 'default' | 'unavailable'

export interface GoBinaryResolution {
  readonly binary: GoBinary
  /** 解析成功時的絕對路徑；不可用時為 undefined。 */
  readonly path?: string
  readonly source: GoBinaryResolutionSource
  /** 實際檢查過的候選路徑，供診斷說明「找過哪裡」。 */
  readonly attempted: readonly string[]
}

export interface ResolveGoBinaryOptions {
  /** 明確指定的路徑，優先於所有其他來源。 */
  readonly override?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly goProjectRoot?: string
  /** 存在性判定；注入後解析即為純函式，測試不需實際安裝 Go 輔助工具。 */
  readonly exists?: (path: string) => boolean
}

/** 目錄對 X_OK 通常會通過，因此必須額外確認是一般檔案。 */
function executableExists(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 以優先序鏈解析一支 Go 輔助工具：明確路徑 > 環境變數 > 相鄰 repo 預設 > 不可用。
 *
 * 高順位一旦被指定就不再往下退：只有「未指定」才落到下一順位，「指定了但不存在」
 * 直接判為不可用，並回報找過的路徑。
 *
 * 這條規則有 ADR-0002 撐腰，不只是「打錯路徑不該被靜默吞掉」而已：該 ADR 讓時長
 * 的來源路徑進入來源追溯指紋，因此靜默退回會讓使用者以為在跑權威路徑、實際卻跑
 * 降級路徑，產出一批來源標記與預期不符的階段產物。改成「找不到就往下試」會讓那個
 * 保證失效——看似比較友善，實則把錯誤延後到無法察覺的地方。
 */
export function resolveGoBinary(
  binary: GoBinary,
  options: ResolveGoBinaryOptions = {}
): GoBinaryResolution {
  const exists = options.exists ?? executableExists
  const env = options.env ?? process.env

  // 空字串代表使用者確實動過這個變數（例如 .env 裡的 `DURATION_GO_BINARY_PATH=`），
  // 視為「指定了一個不存在的路徑」，而非未指定。
  const override = options.override?.trim()
  const fromEnv = env[GO_BINARY_ENV_NAMES[binary]]?.trim()

  const candidate =
    options.override !== undefined
      ? { path: override ?? '', source: 'override' as const }
      : env[GO_BINARY_ENV_NAMES[binary]] !== undefined
        ? { path: fromEnv ?? '', source: 'env' as const }
        : {
            path: resolveGoBinaryPath(binary, options.goProjectRoot),
            source: 'default' as const,
          }

  const attempted = [candidate.path]
  if (!candidate.path || !exists(candidate.path)) {
    return { binary, source: 'unavailable', attempted }
  }
  return { binary, path: candidate.path, source: candidate.source, attempted }
}
