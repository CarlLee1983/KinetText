import { hasProbe } from './probes'
import type { CapabilityRequirement, WorkflowProfile } from './types'

/**
 * Go 輔助工具的能力宣告，供各設定檔共用。
 *
 * 依 CONTEXT.md，Go 輔助工具是選用的增強能力：不健康時核心流程仍應以既有
 * 替代能力維持可用，因此缺席一律是降級而非阻斷。真正沒有替代路徑的能力
 * （ffmpeg）才是阻斷項。
 */
const GO_AUDIO: CapabilityRequirement = {
  id: 'go-audio',
  label: 'Go 音訊轉換輔助工具 (kinetitext-audio)',
  whenMissing: 'degraded',
  fallback: '改以 ffmpeg 轉換，較慢但結果相同',
  remedy: '建置相鄰的 kinetitext-go，或以 AUDIO_GO_BINARY_PATH 指定二進位路徑',
}

const GO_DURATION: CapabilityRequirement = {
  id: 'go-duration',
  label: 'Go 時長輔助工具 (kinetitext-duration)',
  whenMissing: 'degraded',
  fallback:
    '改以 music-metadata 讀取時長；較慢，且依 ADR-0002 屬非權威來源，' +
    '日後裝上 Go 輔助工具會重新產生',
  remedy: '建置相鄰的 kinetitext-go，或以 DURATION_GO_BINARY_PATH 指定二進位路徑',
}

/**
 * m4b 設定檔。
 *
 * ffmpeg 沒有替代路徑，缺席即阻斷；兩支 Go 輔助工具缺席則降級。
 * m4b 不使用 MP4 轉檔輔助工具，因此不在此宣告——設定檔只宣告該流程真正
 * 用到的能力。
 */
export const M4B_PROFILE: WorkflowProfile = {
  name: 'm4b',
  capabilities: [
    {
      id: 'ffmpeg',
      label: 'ffmpeg',
      whenMissing: 'blocked',
      remedy: '請安裝 ffmpeg 後重試（macOS：brew install ffmpeg）',
    },
    GO_DURATION,
    GO_AUDIO,
  ],
}

const REGISTRY: readonly WorkflowProfile[] = [M4B_PROFILE]

/**
 * 註冊時就檢查每項能力都有探測方式。
 *
 * 設定檔是靜態註冊的，漏接探測器是開發者的疏忽而非使用者的環境問題，
 * 因此在模組載入時就失敗，而不是讓使用者拿到一則叫他去安裝東西的訊息。
 */
for (const profile of REGISTRY) {
  for (const capability of profile.capabilities) {
    if (!hasProbe(capability.id)) {
      throw new Error(
        `設定檔 ${profile.name} 宣告的能力 ${capability.id} 沒有對應的探測方式`
      )
    }
  }
}

export const PROFILE_NAMES: readonly string[] = REGISTRY.map((profile) => profile.name)

export function getProfile(name: string): WorkflowProfile | undefined {
  return REGISTRY.find((profile) => profile.name === name)
}

export function allProfiles(): readonly WorkflowProfile[] {
  return REGISTRY
}
