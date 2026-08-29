/**
 * 工作流程啟動前的檢查。
 *
 * 五個 CLI 入口與 TUI 都由此取得判定，因此手動診斷說可以跑的流程，啟動時不會
 * 給出矛盾的答案——一致性是靠共用同一個核心達成，而不是靠各入口自己記得。
 */
import { evaluateProfile } from './evaluate'
import {
  getProfile,
  withAdapterCapabilities,
  type CapabilityDeclaringAdapter,
} from './profiles'
import { probeCapabilities } from './probes'
import type {
  CapabilityVerdict,
  ProbeOutcome,
  ProfileVerdict,
  WorkflowProfile,
} from './types'

/** 探測的執行方式；測試可注入固定結果，不需實際安裝任何工具。 */
export type ProbeRunner = (ids: readonly string[]) => Promise<ProbeOutcome[]>

export interface StartupOptions {
  /** 爬取類流程的目標網址，用來解析適配器的前置條件。 */
  readonly url?: string
  /** 已解析好的適配器；給定時優先於 url。 */
  readonly adapter?: CapabilityDeclaringAdapter
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly probe?: ProbeRunner
}

export interface StartupReport {
  readonly verdict: ProfileVerdict
  /** 存在阻斷項：流程不得啟動。 */
  readonly blocked: boolean
}

/**
 * 解析網址對應的適配器。
 *
 * 動態載入：適配器註冊表會連帶載入 puppeteer，只有真的要爬東西才值得付這個
 * 載入成本。
 */
export async function resolveAdapter(
  url: string | undefined
): Promise<CapabilityDeclaringAdapter | undefined> {
  if (!url) return undefined
  const { getAdapterForUrl } = await import('../adapters')
  return getAdapterForUrl(url)
}

/** 只挑出設定檔宣告的祕密名稱，不把整份環境交給純函式。 */
export function secretValuesFor(
  profile: WorkflowProfile,
  env: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  for (const name of profile.secretNames ?? []) {
    values[name] = env[name]
  }
  return values
}

/** 評估一個工作流程設定檔在目前環境下能否啟動。 */
export async function checkStartup(
  profileName: string,
  options: StartupOptions = {}
): Promise<StartupReport> {
  const base = getProfile(profileName)
  if (!base) {
    throw new Error(`未知的工作流程設定檔：${profileName}`)
  }

  const adapter = options.adapter ?? (await resolveAdapter(options.url))
  const profile = withAdapterCapabilities(base, adapter)

  const env = options.env ?? process.env
  const probe: ProbeRunner =
    options.probe ??
    ((ids) =>
      probeCapabilities(ids, {
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        env,
      }))

  const outcomes = await probe(profile.capabilities.map((capability) => capability.id))
  const verdict = evaluateProfile(profile, outcomes, secretValuesFor(profile, env))

  return { verdict, blocked: !verdict.canProceed }
}

/**
 * 產生要顯示給使用者的啟動檢查說明。
 *
 * 全部可用時回傳空字串——沒有問題就不該在每次執行前製造雜訊。
 */
export function formatStartupReport(verdict: ProfileVerdict): string {
  // 阻斷項先列：使用者最需要看到的是「為什麼不能跑」。
  const lines = [
    ...verdict.blocking.map((capability) => capabilityLine('✗', capability)),
    ...verdict.warnings.map((capability) => capabilityLine('!', capability)),
  ]

  if (lines.length === 0) return ''

  const header = verdict.canProceed
    ? `[診斷] 設定檔 ${verdict.profile} 有警告，流程將以下述回退行為繼續：`
    : `[診斷] 設定檔 ${verdict.profile} 存在阻斷項，流程不啟動：`

  return [header, ...lines].join('\n')
}

/** 與手動診斷同樣附上 detail，兩個入口對同一項能力給出等量的資訊。 */
function capabilityLine(mark: string, capability: CapabilityVerdict): string {
  const detail = capability.detail ? ` [${capability.detail}]` : ''
  return `  ${mark} ${capability.label}${detail}：${capability.message}`
}

/**
 * 在流程啟動前執行檢查：警告印出後繼續，阻斷則不啟動並以非零結束碼結束。
 *
 * 阻斷項沒有略過的旗標——半途失敗會留下半成品，事前擋下才是這個檢查存在的
 * 理由。
 */
export async function enforceStartup(
  profileName: string,
  options: StartupOptions = {}
): Promise<StartupReport> {
  const report = await checkStartup(profileName, options)
  const text = formatStartupReport(report.verdict)

  if (text) {
    console[report.blocked ? 'error' : 'warn'](text)
  }
  if (report.blocked) {
    process.exit(1)
  }
  return report
}
