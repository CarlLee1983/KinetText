/**
 * 工作流程設定檔的診斷型別。
 *
 * 依 CONTEXT.md：工作流程設定檔是「一組對應單一使用者流程的必要條件與可用能力，
 * 用於在執行前評估該流程是否可進行」；設定檔本身不執行流程。
 */

/** 單一能力的判定結果。降級與阻斷對使用者的意義不同，因此不使用布林值。 */
export type CapabilityState = 'available' | 'degraded' | 'blocked'

/** 設定檔宣告的一項本機能力需求。 */
export interface CapabilityRequirement {
  readonly id: string
  readonly label: string
  /** 缺席時的後果：blocked 使流程不可進行；degraded 以替代能力繼續。 */
  readonly whenMissing: 'blocked' | 'degraded'
  /** whenMissing 為 degraded 時，說明將採取的回退行為。 */
  readonly fallback?: string
  /** 缺席時提供給使用者的修復資訊。 */
  readonly remedy: string
}

export interface WorkflowProfile {
  readonly name: string
  readonly capabilities: readonly CapabilityRequirement[]
  /** 此設定檔相關的祕密設定名稱；只用於產生指紋，不保存原始值。 */
  readonly secretNames?: readonly string[]
}

/** 探測層的產出。這是評估層唯一的輸入來源，因此評估可在無外部工具的環境測試。 */
export interface ProbeOutcome {
  readonly id: string
  readonly present: boolean
  readonly version?: string
  /** 補充說明，例如 'timeout'、'cancelled'、'not-found'、'exit-N'。 */
  readonly detail?: string
  /** 探測失敗時的第一行錯誤輸出，用於診斷訊息；不含祕密。 */
  readonly error?: string
  /** 解析時實際找過的路徑，供診斷說明；與工具自身的錯誤輸出區分開。 */
  readonly searched?: string
}

export interface CapabilityVerdict {
  readonly id: string
  readonly label: string
  readonly state: CapabilityState
  readonly version?: string
  readonly detail?: string
  /** 降級時說明回退行為；阻斷時提供修復資訊。 */
  readonly message: string
}

/** 祕密設定指紋：不保存原始祕密值，僅用於判斷相關設定是否變更。 */
export interface SecretFingerprint {
  readonly name: string
  readonly fingerprint: string
}

export interface ProfileVerdict {
  readonly profile: string
  readonly canProceed: boolean
  readonly capabilities: readonly CapabilityVerdict[]
  readonly blocking: readonly CapabilityVerdict[]
  readonly warnings: readonly CapabilityVerdict[]
  readonly secretFingerprints: readonly SecretFingerprint[]
}
