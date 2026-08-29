import { formatCliError } from '../src/cli/common'
import { evaluateProfile, exitCodeFor, renderHuman, renderJson } from '../src/diagnostics/evaluate'
import { allProfiles, getProfile, PROFILE_NAMES } from '../src/diagnostics/profiles'
import { probeCapabilities } from '../src/diagnostics/probes'
import type { ProfileVerdict, WorkflowProfile } from '../src/diagnostics/types'

/** 使用者中止時的慣例結束碼。 */
const EXIT_CANCELLED = 130

const KNOWN_FLAGS = ['--help', '-h', '--json'] as const
const KNOWN_PREFIXES = ['--profile=', '--timeout='] as const

function printUsage() {
  console.log('Usage: bun run doctor [options]')
  console.log('Options:')
  console.log('  --help, -h         顯示說明')
  console.log('  --profile=<name>   只檢查指定的工作流程設定檔（預設檢查全部）')
  console.log('  --json             以 JSON 輸出，供腳本消費')
  console.log('  --timeout=<ms>     單一探測的逾時上限（預設 5000）')
  console.log(`可用設定檔：${PROFILE_NAMES.join(', ')}`)
  console.log('選取範圍內存在阻斷項時，以非零結束碼結束。')
}

/** 未知旗標視為錯誤：打錯的 --jsn 若被靜默忽略，會得到誤導的成功輸出。 */
function assertKnownFlags(args: readonly string[]): void {
  for (const arg of args) {
    if (!arg.startsWith('-')) continue
    if ((KNOWN_FLAGS as readonly string[]).includes(arg)) continue
    if (KNOWN_PREFIXES.some((prefix) => arg.startsWith(prefix))) continue
    throw new Error(`未知的旗標：${arg}（以 --help 查看可用選項）`)
  }
}

function parseTimeout(args: readonly string[]): number | undefined {
  const flag = args.find((arg) => arg.startsWith('--timeout='))
  if (!flag) return undefined

  const parsed = Number.parseInt(flag.substring('--timeout='.length), 10)
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error('--timeout 必須為正整數毫秒')
  }
  return parsed
}

function selectProfiles(args: readonly string[]): readonly WorkflowProfile[] {
  const name = args
    .find((arg) => arg.startsWith('--profile='))
    ?.substring('--profile='.length)
  if (!name) return allProfiles()

  const profile = getProfile(name)
  if (!profile) {
    throw new Error(`未知的設定檔：${name}（可用：${PROFILE_NAMES.join(', ')}）`)
  }
  return [profile]
}

/** 只挑出設定檔宣告的祕密名稱，不把整份環境交給純函式。 */
function secretValuesFor(
  profile: WorkflowProfile,
  env: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  for (const name of profile.secretNames ?? []) {
    values[name] = env[name]
  }
  return values
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  assertKnownFlags(args)
  const asJson = args.includes('--json')
  const timeoutMs = parseTimeout(args)
  const selected = selectProfiles(args)

  // Ctrl-C 取消進行中的診斷，而不是留下半跑完的探測。
  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())

  // 多個設定檔常共用同一項能力，同一次執行內只探測一次。
  const capabilityIds = selected.flatMap((profile) =>
    profile.capabilities.map((capability) => capability.id)
  )
  const outcomes = await probeCapabilities(capabilityIds, {
    timeoutMs,
    signal: controller.signal,
  })

  if (controller.signal.aborted) {
    console.error('[Cancelled] 診斷已由使用者中止')
    process.exit(EXIT_CANCELLED)
  }

  const verdicts: ProfileVerdict[] = selected.map((profile) =>
    evaluateProfile(profile, outcomes, secretValuesFor(profile, process.env))
  )

  console.log(asJson ? renderJson(verdicts) : renderHuman(verdicts))
  process.exit(exitCodeFor(verdicts))
}

main().catch((error) => {
  console.error(`[Error] ${formatCliError(error)}`)
  process.exit(1)
})
