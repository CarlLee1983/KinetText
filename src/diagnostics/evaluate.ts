import type {
  CapabilityRequirement,
  CapabilityVerdict,
  ProbeOutcome,
  ProfileVerdict,
  SecretFingerprint,
  WorkflowProfile,
} from './types'
import { secretFingerprint } from './secrets'

/** JSON 輸出的契約版本。結構變更時遞增，讓消費端能偵測。 */
export const JSON_SCHEMA_VERSION = 1

/**
 * 依探測結果評估單一工作流程設定檔。
 *
 * 純函式：不讀取環境、不觸碰檔案系統、不修改傳入的探測結果。所有與外界的互動
 * 都留在探測層，因此絕大多數情境可在未安裝任何外部工具的環境下測試。
 */
export function evaluateProfile(
  profile: WorkflowProfile,
  outcomes: readonly ProbeOutcome[],
  secretValues: Readonly<Record<string, string | undefined>> = {}
): ProfileVerdict {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]))

  const capabilities = profile.capabilities.map((requirement) =>
    judge(requirement, byId.get(requirement.id))
  )

  const blocking = capabilities.filter((c) => c.state === 'blocked')
  const warnings = capabilities.filter((c) => c.state === 'degraded')

  const secretFingerprints: SecretFingerprint[] = (profile.secretNames ?? []).map(
    (name) => ({ name, fingerprint: secretFingerprint(secretValues[name], name) })
  )

  return {
    profile: profile.name,
    canProceed: blocking.length === 0,
    capabilities,
    blocking,
    warnings,
    secretFingerprints,
  }
}

/** 沒有對應探測結果的能力視為缺席，而非略過——略過會讓流程半途才失敗。 */
function judge(
  requirement: CapabilityRequirement,
  outcome: ProbeOutcome | undefined
): CapabilityVerdict {
  if (outcome?.present) {
    return {
      id: requirement.id,
      label: requirement.label,
      state: 'available',
      version: outcome.version,
      detail: outcome.detail,
      message: '可用',
    }
  }

  const degraded = requirement.whenMissing === 'degraded'
  return {
    id: requirement.id,
    label: requirement.label,
    state: degraded ? 'degraded' : 'blocked',
    detail: outcome?.detail,
    message: messageFor(requirement, outcome, degraded),
  }
}

/**
 * 缺席的原因決定該說什麼。
 *
 * 逾時與取消不表示工具沒裝，叫使用者去安裝是誤導；未註冊探測方式則是
 * 開發者漏接，不是使用者的環境問題。
 */
function messageFor(
  requirement: CapabilityRequirement,
  outcome: ProbeOutcome | undefined,
  degraded: boolean
): string {
  switch (outcome?.detail) {
    case 'timeout':
      return `${requirement.label} 探測逾時；工具可能存在但無回應，可提高 --timeout 後重試`
    case 'cancelled':
      return `${requirement.label} 探測已取消，本次結果不代表它不可用`
    case 'no-probe':
      return `內部設定缺漏：能力 ${requirement.id} 尚未註冊探測方式`
    default:
      break
  }

  const base = degraded ? (requirement.fallback ?? requirement.remedy) : requirement.remedy
  return outcome?.error ? `${base}（${outcome.error}）` : base
}

/** 選取範圍內存在阻斷項時為非零，供 CI 直接判定成敗。 */
export function exitCodeFor(verdicts: readonly ProfileVerdict[]): number {
  return verdicts.every((verdict) => verdict.canProceed) ? 0 : 1
}

/**
 * JSON 輸出：結構穩定，供腳本消費；不含任何原始祕密值。
 *
 * 缺值輸出 null 而非省略鍵，讓消費端的欄位集合在各種情境下一致。
 */
export function renderJson(verdicts: readonly ProfileVerdict[]): string {
  return JSON.stringify(
    {
      schemaVersion: JSON_SCHEMA_VERSION,
      canProceed: verdicts.every((verdict) => verdict.canProceed),
      profiles: verdicts.map((verdict) => ({
        profile: verdict.profile,
        canProceed: verdict.canProceed,
        capabilities: verdict.capabilities.map((capability) => ({
          id: capability.id,
          label: capability.label,
          state: capability.state,
          version: capability.version ?? null,
          detail: capability.detail ?? null,
          message: capability.message,
        })),
        blocking: verdict.blocking.map((capability) => capability.id),
        warnings: verdict.warnings.map((capability) => capability.id),
        secrets: verdict.secretFingerprints,
      })),
    },
    null,
    2
  )
}

const STATE_MARK: Record<CapabilityVerdict['state'], string> = {
  available: '✓ 可用',
  degraded: '! 警告',
  blocked: '✗ 阻斷',
}

/** 人類可讀輸出：阻斷與警告明確區分，阻斷附帶修復資訊。 */
export function renderHuman(verdicts: readonly ProfileVerdict[]): string {
  const lines: string[] = []

  for (const verdict of verdicts) {
    const summary = verdict.canProceed ? '可進行' : '不可進行（存在阻斷項）'
    lines.push(`設定檔 ${verdict.profile}：${summary}`)

    for (const capability of verdict.capabilities) {
      const version = capability.version ? ` (${capability.version})` : ''
      const detail = capability.detail ? ` [${capability.detail}]` : ''
      lines.push(`  ${STATE_MARK[capability.state]}  ${capability.label}${version}${detail}`)
      if (capability.state !== 'available') {
        lines.push(`      ${capability.message}`)
      }
    }

    for (const secret of verdict.secretFingerprints) {
      lines.push(`  · 祕密設定 ${secret.name} 指紋 ${secret.fingerprint}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
