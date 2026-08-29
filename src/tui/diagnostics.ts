/**
 * TUI 的診斷摘要與啟動前驗證。
 *
 * 摘要只是「上次看到的樣子」，可能已經過期；真正啟動流程前一律重新探測，
 * 因為使用者很可能就是在看到摘要之後才去把缺的工具裝上。
 */
import { checkStartup, formatStartupReport, type ProbeRunner } from '../diagnostics/startup'
import { PROFILE_NAMES } from '../diagnostics/profiles'
import type { ProfileVerdict } from '../diagnostics/types'

export interface DiagnosticsSummary {
  readonly checkedAt: Date
  readonly profiles: readonly ProfileVerdict[]
}

export interface DiagnosticsOptions {
  readonly timeoutMs?: number
  readonly probe?: ProbeRunner
  /** 探測要使用的環境；應與實際啟動子程序時的環境相同。 */
  readonly env?: Readonly<Record<string, string | undefined>>
}

export interface LaunchDecision {
  readonly canLaunch: boolean
  /** 要顯示給使用者的說明；沒有問題時為空字串。 */
  readonly report: string
}

export interface DiagnosticsSession {
  getLastSummary(): DiagnosticsSummary | undefined
  runDiagnostics(options?: DiagnosticsOptions): Promise<DiagnosticsSummary>
  ensureCanLaunch(
    profileName: string,
    options?: DiagnosticsOptions & { readonly url?: string }
  ): Promise<LaunchDecision>
  guardLaunch(
    profileName: string,
    options?: DiagnosticsOptions & { readonly url?: string }
  ): Promise<boolean>
}

/**
 * 建立一個獨立的診斷工作階段。
 *
 * 摘要是可變狀態，做成 session 而非模組層變數，測試就不需要一個只為重置而
 * 存在的公開 API，也不會在共用 module registry 下跨檔案滲漏。
 */
export function createDiagnosticsSession(): DiagnosticsSession {
  let lastSummary: DiagnosticsSummary | undefined

  function getLastSummary(): DiagnosticsSummary | undefined {
    return lastSummary
  }

  async function runDiagnostics(
    options: DiagnosticsOptions = {}
  ): Promise<DiagnosticsSummary> {
    const profiles: ProfileVerdict[] = []
    for (const name of PROFILE_NAMES) {
      const report = await checkStartup(name, options)
      profiles.push(report.verdict)
    }

    lastSummary = { checkedAt: new Date(), profiles }
    return lastSummary
  }

  async function ensureCanLaunch(
    profileName: string,
    options: DiagnosticsOptions & { readonly url?: string } = {}
  ): Promise<LaunchDecision> {
    const report = await checkStartup(profileName, options)

    // 剛剛取得的是新鮮判定，讓摘要跟上；否則使用者被擋下後回到摘要，會看到
    // 一份仍寫著「可進行」的舊資料，兩者互相矛盾。
    if (lastSummary) {
      lastSummary = {
        checkedAt: new Date(),
        profiles: lastSummary.profiles.map((verdict) =>
          verdict.profile === report.verdict.profile ? report.verdict : verdict
        ),
      }
    }

    return {
      canLaunch: !report.blocked,
      report: formatStartupReport(report.verdict),
    }
  }

  async function guardLaunch(
    profileName: string,
    options: DiagnosticsOptions & { readonly url?: string } = {}
  ): Promise<boolean> {
    const decision = await ensureCanLaunch(profileName, options)
    if (!decision.canLaunch) {
      console.error(`\n${decision.report}\n`)
    }
    // 放行時不輸出：警告由子程序的啟動檢查印出一次，這裡再印是重複。
    return decision.canLaunch
  }

  return { getLastSummary, runDiagnostics, ensureCanLaunch, guardLaunch }
}

/** TUI 全程共用的工作階段。 */
const session = createDiagnosticsSession()

export const getLastSummary = session.getLastSummary
export const runDiagnostics = session.runDiagnostics
export const ensureCanLaunch = session.ensureCanLaunch
export const guardLaunch = session.guardLaunch

/** 相對時間；讓使用者一眼看出這份摘要有多舊。 */
function describeAge(checkedAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - checkedAt.getTime()) / 60_000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘前`
  return `${Math.floor(minutes / 60)} 小時前`
}

/**
 * 呈現最近一次摘要。
 *
 * 阻斷與警告都展開：警告帶著回退說明與修復資訊，而 guardLaunch 刻意不印警告，
 * 因此這裡是 TUI 使用者在啟動前唯一能看到降級說明的地方。
 */
export function formatSummary(
  summary: DiagnosticsSummary | undefined,
  now: Date = new Date()
): string {
  if (!summary) {
    return '尚未執行診斷。選擇「重新檢查」以取得目前狀態。'
  }

  const lines = [`最近一次診斷：${describeAge(summary.checkedAt, now)}`]

  for (const verdict of summary.profiles) {
    const mark = verdict.canProceed ? '✓' : '✗'
    const status = verdict.canProceed ? '可進行' : '不可進行'
    lines.push(`  ${mark} ${verdict.profile}：${status}`)

    for (const capability of verdict.blocking) {
      lines.push(`      ✗ ${capability.label}：${capability.message}`)
    }
    for (const capability of verdict.warnings) {
      lines.push(`      ! ${capability.label}：${capability.message}`)
    }
  }

  return lines.join('\n')
}
