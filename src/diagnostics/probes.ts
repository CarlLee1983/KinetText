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

/** 能力 id 對應的探測方式。新增能力時只需在此註冊。 */
const PROBES: Record<string, (context: ProbeContext) => Promise<ProbeOutcome>> = {
  ffmpeg: (context) => probeExecutable('ffmpeg', 'ffmpeg', ['-version'], context),
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
