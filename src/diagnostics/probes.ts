/**
 * 探測層：本模組是診斷中唯一與外界互動的一層。
 *
 * 模組契約：
 * - 無副作用。探測只讀取工具的版本或本機設定，不寫入檔案、不修改任何設定、
 *   不對外部網站或服務發出連線。
 * - 每個探測都有逾時上限，逾時計為不可用，不得讓診斷卡住。
 * - 可被外部訊號取消。
 * - 探測結果是評估層唯一的輸入，因此評估可在無任何外部工具的環境測試。
 * - 工具的原始輸出不進入 ProbeOutcome：需要解析輸出的探測器在本模組內部取用，
 *   避免把數十行建置參數或使用者的遠端清單掛到跨層型別上。
 */
import { statSync } from 'node:fs'
import { backupRemoteNames, isExampleDestinations } from '../config/backupDestinations'
import { resolveGoBinary, type GoBinary } from '../config/goBinaryPaths'
import type { ProbeOutcome, WorkflowProfile } from './types'

export interface ProbeContext {
  /** 單一探測的逾時上限。 */
  readonly timeoutMs?: number
  /** 外部取消訊號，讓使用者能中止進行中的診斷。 */
  readonly signal?: AbortSignal
  /**
   * 能力 id → 明確指定的可執行檔路徑。
   * 這是解析優先序鏈的最高順位，高於環境變數與各探測器的預設。
   */
  readonly overrides?: Readonly<Record<string, string>>
  /** 探測器可讀取的環境變數來源；預設為行程環境。 */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** 同一次執行內的執行結果快取，由 probeCapabilities 建立。 */
  readonly cache?: Map<string, Promise<ExecutionResult>>
}

const DEFAULT_TIMEOUT_MS = 5000

interface ExecutionResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  /** 失敗原因：'timeout' | 'cancelled' | 'not-found' | 'exit-N'。 */
  readonly detail?: string
}

/** 執行一個外部命令並取得輸出。同一次執行內，相同的命令與參數只跑一次。 */
async function runExecutable(
  executable: string,
  args: readonly string[],
  context: ProbeContext
): Promise<ExecutionResult> {
  const key = [executable, ...args].join(' ')
  const cached = context.cache?.get(key)
  if (cached) return cached

  const pending = executeOnce(executable, args, context)
  context.cache?.set(key, pending)
  return pending
}

async function executeOnce(
  executable: string,
  args: readonly string[],
  context: ProbeContext
): Promise<ExecutionResult> {
  const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const empty = { stdout: '', stderr: '' }

  if (context.signal?.aborted) return { ok: false, ...empty, detail: 'cancelled' }

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  context.signal?.addEventListener('abort', onExternalAbort, { once: true })

  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const proc = Bun.spawn([executable, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal: controller.signal,
      killSignal: 'SIGKILL',
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    if (timedOut) return { ok: false, ...empty, detail: 'timeout' }
    if (context.signal?.aborted) return { ok: false, ...empty, detail: 'cancelled' }
    if (exitCode !== 0) return { ok: false, stdout, stderr, detail: `exit-${exitCode}` }
    return { ok: true, stdout, stderr }
  } catch {
    if (timedOut) return { ok: false, ...empty, detail: 'timeout' }
    if (context.signal?.aborted) return { ok: false, ...empty, detail: 'cancelled' }
    return { ok: false, ...empty, detail: 'not-found' }
  } finally {
    clearTimeout(timeoutId)
    context.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 探測單一可執行檔是否可用並取得版本。
 *
 * `command` 是預設路徑；若 context 的 overrides 針對 `overrideKey`（預設為 id）
 * 指定了路徑，則以其為準。
 */
export async function probeExecutable(
  id: string,
  command: string,
  args: readonly string[] = ['-version'],
  context: ProbeContext = {},
  overrideKey: string = id
): Promise<ProbeOutcome> {
  const executable = context.overrides?.[overrideKey] ?? command
  const result = await runExecutable(executable, args, context)

  if (!result.ok) {
    return { id, present: false, detail: result.detail, error: firstLine(result.stderr) }
  }
  return { id, present: true, version: parseVersion(result.stdout) }
}

/**
 * 從版本輸出擷取版本字串。
 *
 * 抓不到版本樣式時回傳 undefined 而非整行輸出——把工具的其他輸出當成版本，
 * 會讓來源追溯記下一個看似有效實則無意義的版本。
 */
function parseVersion(stdout: string): string | undefined {
  const firstOutputLine = stdout.split('\n')[0]?.trim()
  if (!firstOutputLine) return undefined
  return firstOutputLine.match(/\d+\.\S*/)?.[0]
}

function firstLine(text: string): string | undefined {
  const line = text.split('\n')[0]?.trim()
  return line || undefined
}

interface GoBinaryProbeOptions {
  /**
   * 是否有使用者流程真的會用到這支輔助工具。
   *
   * 目前三支都沒有接上：DurationService 的 Go 後端預設關閉且所有建構點都不傳
   * deps；AudioConvertService 只在 benchmark 裡被建構；yt-pipeline 直接呼叫
   * ffmpeg 而不經 MP4ConversionService。二進位在不在，因此不足以說明流程會不會
   * 走 Go——這個旗標讓診斷說出實情，而不是宣告一條走不到的路徑。
   */
  readonly wired: boolean
}

/**
 * 以優先序鏈解析一支 Go 輔助工具，並以「可執行檔存在」判定可用。
 *
 * 這三支二進位不支援版本旗標——實測顯示它們忽略任何參數，直接把 stdin 當
 * JSON IPC 讀，EOF 時仍以 exit 0 收場。因此不執行它們來判定存在：那會讓
 * 可用性取決於一個碰巧為零的結束碼，且拿不到真正的版本。版本欄位維持
 * undefined，直到 Go 端提供版本子命令。
 */
function goBinaryProbe(id: string, binary: GoBinary, options: GoBinaryProbeOptions) {
  return async (context: ProbeContext): Promise<ProbeOutcome> => {
    if (context.signal?.aborted) return { id, present: false, detail: 'cancelled' }

    const env = context.env ?? process.env
    const resolution = resolveGoBinary(binary, {
      override: context.overrides?.[id],
      env,
    })

    if (resolution.source === 'unavailable') {
      return {
        id,
        present: false,
        detail: 'unavailable',
        searched: resolution.attempted.join('、'),
      }
    }

    // 二進位在，但被環境變數關掉時實際上不會被使用。「沒裝」與「裝了但關掉」
    // 對使用者的下一步完全不同，因此以不同的 detail 區分。
    // 即使不會被使用，仍回報解析到的路徑：優先序鏈的結果是使用者指定二進位
    // 位置時唯一能確認「我指的那支被找到了」的證據。
    if (!isGoBinaryEnabled(binary, env)) {
      return { id, present: false, detail: 'disabled', searched: resolution.path }
    }

    if (!options.wired) {
      return { id, present: false, detail: 'not-wired', searched: resolution.path }
    }

    return { id, present: true, detail: `resolved-by-${resolution.source}` }
  }
}

/**
 * 各支輔助工具的啟用旗標。
 *
 * 預設值沿用既有 Go 設定模組：音訊與時長預設開啟，MP4 轉檔預設關閉
 * （`MP4ConvertGoConfig` 用的是 `=== 'true'`）。
 */
function isGoBinaryEnabled(
  binary: GoBinary,
  env: Readonly<Record<string, string | undefined>>
): boolean {
  switch (binary) {
    case 'audio':
      return env.AUDIO_GO_ENABLED !== 'false'
    case 'duration':
      return env.DURATION_GO_ENABLED !== 'false'
    case 'mp4convert':
      return env.MP4_GO_ENABLED === 'true'
  }
}

/**
 * 解析 `rclone listremotes` 的輸出，找出備份目標需要但尚未設定的遠端。
 *
 * 純函式，與執行分離：遠端名稱比對的規則（尾隨冒號、空白行、大小寫）值得
 * 完整測試，但不該為此要求測試環境裝上 rclone。
 */
export function missingRemotes(
  listRemotesOutput: string,
  required: readonly string[] = backupRemoteNames()
): string[] {
  const configured = new Set(
    listRemotesOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith(':'))
      .map((line) => line.slice(0, -1))
  )
  return required.filter((name) => !configured.has(name))
}

/**
 * 探測備份遠端設定。
 *
 * 依 CONTEXT.md：只確認具名遠端存在且可辨識，不提前驗證連線或權限。
 * `rclone listremotes` 只讀本機設定檔，不發出任何網路請求。
 */
async function rcloneRemotesProbe(context: ProbeContext): Promise<ProbeOutcome> {
  const id = 'rclone-remotes'

  // 目標清單仍是出廠範例，代表使用者還沒設定備份目標。這是「尚未設定」而非
  // 「設定壞了」，以警告表達；否則沒用到備份的人會拿到恆為失敗的結束碼。
  if (isExampleDestinations()) {
    return { id, present: false, state: 'degraded', detail: 'example-destinations' }
  }

  const required = backupRemoteNames()
  if (required.length === 0) {
    return { id, present: true, detail: 'no-remotes-required' }
  }

  const executable = context.overrides?.rclone ?? 'rclone'
  const result = await runExecutable(executable, ['listremotes'], context)
  if (!result.ok) {
    return {
      id,
      present: false,
      detail: result.detail === 'not-found' ? 'rclone-missing' : result.detail,
    }
  }

  const missing = missingRemotes(result.stdout, required)
  if (missing.length > 0) {
    return { id, present: false, detail: 'remote-not-configured', missing }
  }
  return { id, present: true, detail: `${required.length} 個遠端已設定` }
}

/**
 * 探測本機是否有可用的 Chromium。
 *
 * 由 puppeteer 自己解析路徑，而不是掃描快取目錄看有沒有東西：puppeteer 解析的
 * 是它自己版本所釘住的那一個 buildId，快取裡有「某個」Chromium 不代表它找得到
 * 那一個。快取有 148 而 puppeteer 釘 146 時，掃描法會回報可用，實際啟動卻會以
 * 「Could not find Chrome」失敗——正是這個里程碑要消滅的失敗模式。
 *
 * 這裡動態 import puppeteer 而非靜態：唯一會執行本探測的路徑是「網址解析到需要
 * 瀏覽器的適配器」，而該路徑上適配器註冊表早已載入、puppeteer 就在記憶體裡；
 * 其餘設定檔則完全不付這個載入成本。
 */
async function browserProbe(context: ProbeContext): Promise<ProbeOutcome> {
  const id = 'browser'
  const env = context.env ?? process.env

  const explicit = context.overrides?.[id] ?? env.PUPPETEER_EXECUTABLE_PATH
  const path = explicit ?? (await puppeteerExecutablePath())

  if (!path) {
    return { id, present: false, detail: 'resolve-failed' }
  }
  return isExecutableFile(path)
    ? { id, present: true, detail: explicit ? 'explicit-path' : 'puppeteer-resolved', searched: path }
    : { id, present: false, detail: 'unavailable', searched: path }
}

/** puppeteer 對其釘住版本所解析出的執行檔路徑；無法解析時回 undefined。 */
async function puppeteerExecutablePath(): Promise<string | undefined> {
  try {
    const { default: puppeteer } = await import('puppeteer')
    return puppeteer.executablePath()
  } catch {
    return undefined
  }
}

/** 必須是檔案：指向目錄的路徑（例如誤設成 /tmp）不是可用的瀏覽器。 */
function isExecutableFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
}

/** 能力 id 對應的探測方式。新增能力時只需在此註冊。 */
const PROBES: Record<string, (context: ProbeContext) => Promise<ProbeOutcome>> = {
  ffmpeg: (context) => probeExecutable('ffmpeg', 'ffmpeg', ['-version'], context),
  'go-audio': goBinaryProbe('go-audio', 'audio', { wired: false }),
  'go-duration': goBinaryProbe('go-duration', 'duration', { wired: false }),
  'go-mp4convert': goBinaryProbe('go-mp4convert', 'mp4convert', { wired: false }),
  rclone: (context) => probeExecutable('rclone', 'rclone', ['version'], context),
  'rclone-remotes': rcloneRemotesProbe,
  browser: browserProbe,
}

/** 某個能力 id 是否已註冊探測方式。設定檔註冊時用來擋開發者漏接。 */
export function hasProbe(id: string): boolean {
  return id in PROBES
}

/**
 * 探測一組能力 id，重複的 id 只探測一次。
 *
 * 同一次執行內另建一份執行快取，讓不同能力共用同一個外部命令的結果
 * （例如 rclone 的存在判定與遠端清單）。
 */
export async function probeCapabilities(
  ids: readonly string[],
  context: ProbeContext = {}
): Promise<ProbeOutcome[]> {
  const runContext: ProbeContext = { ...context, cache: context.cache ?? new Map() }
  const unique = [...new Set(ids)]

  return Promise.all(
    unique.map((id) => {
      const probe = PROBES[id]
      if (!probe) {
        return Promise.resolve<ProbeOutcome>({ id, present: false, detail: 'no-probe' })
      }
      return probe(runContext)
    })
  )
}

/** 探測一個設定檔宣告的所有能力。 */
export async function probeProfile(
  profile: WorkflowProfile,
  context: ProbeContext = {}
): Promise<ProbeOutcome[]> {
  return probeCapabilities(
    profile.capabilities.map((requirement) => requirement.id),
    context
  )
}
