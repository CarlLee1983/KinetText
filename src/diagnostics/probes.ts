/**
 * 探測層：本模組是診斷中唯一與外界互動的一層。
 *
 * 模組契約：
 * - 無副作用。探測只讀取工具的版本輸出，不寫入檔案、不修改任何設定、
 *   不對外部網站或服務發出連線。
 * - 每個探測都有逾時上限，逾時計為不可用，不得讓診斷卡住。
 * - 可被外部訊號取消。
 * - 探測結果是評估層唯一的輸入，因此評估可在無任何外部工具的環境測試。
 */
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
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * 探測單一可執行檔是否可用並取得版本。
 *
 * `command` 是預設路徑；若 context 的 overrides 針對此 id 指定了路徑，則以其為準。
 */
export async function probeExecutable(
  id: string,
  command: string,
  args: readonly string[] = ['-version'],
  context: ProbeContext = {}
): Promise<ProbeOutcome> {
  const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const executable = context.overrides?.[id] ?? command

  if (context.signal?.aborted) {
    return { id, present: false, detail: 'cancelled' }
  }

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

    if (timedOut) return { id, present: false, detail: 'timeout' }
    if (context.signal?.aborted) return { id, present: false, detail: 'cancelled' }
    if (exitCode !== 0) {
      return { id, present: false, detail: `exit-${exitCode}`, error: firstLine(stderr) }
    }

    return { id, present: true, version: parseVersion(stdout) }
  } catch {
    if (timedOut) return { id, present: false, detail: 'timeout' }
    if (context.signal?.aborted) return { id, present: false, detail: 'cancelled' }
    return { id, present: false, detail: 'not-found' }
  } finally {
    clearTimeout(timeoutId)
    context.signal?.removeEventListener('abort', onExternalAbort)
  }
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

/**
 * 以優先序鏈解析一支 Go 輔助工具，並以「可執行檔存在」判定可用。
 *
 * 這三支二進位不支援版本旗標——實測顯示它們忽略任何參數，直接把 stdin 當
 * JSON IPC 讀，EOF 時仍以 exit 0 收場。因此不執行它們來判定存在：那會讓
 * 可用性取決於一個碰巧為零的結束碼，且拿不到真正的版本。版本欄位維持
 * undefined，直到 Go 端提供版本子命令。
 */
function goBinaryProbe(id: string, binary: GoBinary) {
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
    if (!isGoBinaryEnabled(binary, env)) {
      return { id, present: false, detail: 'disabled', searched: resolution.path }
    }

    return { id, present: true, detail: `resolved-by-${resolution.source}` }
  }
}

/**
 * 各支輔助工具的啟用旗標。
 *
 * 預設值沿用既有 Go 設定模組：音訊與時長預設開啟，MP4 轉檔預設關閉
 * （`MP4ConvertGoConfig` 用的是 `=== 'true'`）。診斷若忽略這些旗標，就會在
 * MP4 轉檔實際走 ffmpeg 時宣稱它走 Go。
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

/** 能力 id 對應的探測方式。新增能力時只需在此註冊。 */
const PROBES: Record<string, (context: ProbeContext) => Promise<ProbeOutcome>> = {
  ffmpeg: (context) => probeExecutable('ffmpeg', 'ffmpeg', ['-version'], context),
  'go-audio': goBinaryProbe('go-audio', 'audio'),
  'go-duration': goBinaryProbe('go-duration', 'duration'),
  'go-mp4convert': goBinaryProbe('go-mp4convert', 'mp4convert'),
}

/** 某個能力 id 是否已註冊探測方式。設定檔註冊時用來擋開發者漏接。 */
export function hasProbe(id: string): boolean {
  return id in PROBES
}

/**
 * 探測一組能力 id，重複的 id 只探測一次。
 *
 * 多個設定檔常共用同一項能力（ffmpeg、Go 輔助工具），同一次執行內重探
 * 只是多餘的子程序。
 */
export async function probeCapabilities(
  ids: readonly string[],
  context: ProbeContext = {}
): Promise<ProbeOutcome[]> {
  const unique = [...new Set(ids)]
  return Promise.all(
    unique.map((id) => {
      const probe = PROBES[id]
      if (!probe) {
        return Promise.resolve<ProbeOutcome>({ id, present: false, detail: 'no-probe' })
      }
      return probe(context)
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
