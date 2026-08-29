import { hasProbe } from './probes'
import type { WorkflowProfile } from './types'

/**
 * m4b 設定檔。
 *
 * 目前只宣告 ffmpeg 一項能力；Go 輔助工具的解析與降級語意由後續切片加入。
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
