import { hasProbe } from './probes'
import type { CapabilityRequirement, WorkflowProfile } from './types'

/**
 * Go 輔助工具的能力宣告。
 *
 * 依 CONTEXT.md，Go 輔助工具是選用的增強能力：不健康時核心流程仍應以既有
 * 替代能力維持可用，因此缺席一律是降級而非阻斷。真正沒有替代路徑的能力
 * （ffmpeg、rclone）才是阻斷項。
 *
 * 只宣告時長這一支。音訊轉換與 MP4 轉檔的輔助工具目前沒有任何使用者流程會
 * 呼叫到——AudioConvertService 只在 benchmark 裡被建構，yt-pipeline 直接呼叫
 * ffmpeg 而不經 MP4ConversionService——宣告它們等於讓診斷描述一條走不到的
 * 路徑。時長這一支保留，因為 ADR-0002 以它為權威來源，但探測會標示它尚未
 * 接上任何流程。
 */
const GO_DURATION: CapabilityRequirement = {
  id: 'go-duration',
  label: 'Go 時長輔助工具 (kinetitext-duration)',
  whenMissing: 'degraded',
  fallback:
    '時長改以 music-metadata 讀取；依 ADR-0002 屬非權威來源，' +
    '待 Go 後端接上並產生權威時長後會重新產生',
  remedy: '建置相鄰的 kinetitext-go，或以 DURATION_GO_BINARY_PATH 指定二進位路徑',
}

const FFMPEG: CapabilityRequirement = {
  id: 'ffmpeg',
  label: 'ffmpeg',
  whenMissing: 'blocked',
  remedy: '請安裝 ffmpeg 後重試（macOS：brew install ffmpeg）',
}

const RCLONE: CapabilityRequirement = {
  id: 'rclone',
  label: 'rclone',
  whenMissing: 'blocked',
  remedy: '請安裝 rclone 後重試（macOS：brew install rclone）',
}

const RCLONE_REMOTES: CapabilityRequirement = {
  id: 'rclone-remotes',
  label: '備份遠端設定',
  whenMissing: 'blocked',
  remedy: '請以 rclone config 設定備份目標所需的具名遠端',
}

const BROWSER: CapabilityRequirement = {
  id: 'browser',
  label: '瀏覽器 (Chromium)',
  whenMissing: 'blocked',
  remedy:
    '執行 bunx puppeteer browsers install chrome，' +
    '或以 PUPPETEER_EXECUTABLE_PATH 指定既有的瀏覽器',
}

/**
 * 適配器可宣告的本機能力。
 *
 * 適配器只宣告 id，實際的標籤、嚴重度與修復資訊集中在此，因此新增一個需要
 * 瀏覽器的適配器不必修改評估邏輯，只要宣告已知的 id。
 */
const ADAPTER_CAPABILITIES: Readonly<Record<string, CapabilityRequirement>> = {
  browser: BROWSER,
}

/** 使用 Microsoft Edge TTS 的流程共用的祕密設定名稱。 */
const TTS_SECRETS = ['MICROSOFT_TTS_TOKEN', 'MICROSOFT_TOKEN_REFRESH_URL'] as const

/**
 * 爬取設定檔。
 *
 * 爬取不需要任何本機媒體工具，線上小說站的可用性依里程碑的非範圍不預先檢查。
 * 網站適配器前置條件只在網址解析到該適配器後才成為檢查項，由 T4 加入。
 */
const CRAWL_PROFILE: WorkflowProfile = {
  name: 'crawl',
  capabilities: [],
  includesCrawl: true,
}

/**
 * 有聲書設定檔。
 *
 * TTS 直接寫出 mp3，不經 ffmpeg；Edge TTS 是線上服務，依非範圍不預先連線。
 * 因此本流程沒有本機能力需求，只有祕密設定需要記錄指紋。
 */
const AUDIOBOOK_PROFILE: WorkflowProfile = {
  name: 'audiobook',
  capabilities: [],
  secretNames: TTS_SECRETS,
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
  capabilities: [FFMPEG, GO_DURATION],
}

/**
 * YouTube 影片設定檔。
 *
 * 串接爬取、TTS、時長合併、封面與 MP4 產出。MP4 階段直接呼叫 ffmpeg
 * （見 yt_pipeline 的第 ④ 階段），因此不宣告 MP4 轉檔輔助工具。
 */
const YOUTUBE_PROFILE: WorkflowProfile = {
  name: 'youtube',
  capabilities: [FFMPEG, GO_DURATION],
  secretNames: TTS_SECRETS,
  includesCrawl: true,
}

/**
 * 備份設定檔。
 *
 * 依 CONTEXT.md 對備份遠端設定的界定：只確認 rclone 與具名遠端設定存在且
 * 可辨識，不提前驗證遠端連線或權限。
 */
const BACKUP_PROFILE: WorkflowProfile = {
  name: 'backup',
  capabilities: [RCLONE, RCLONE_REMOTES],
}

/** 適配器可宣告的能力 id。適配器測試據此守住「宣告的都在目錄內」。 */
export const ADAPTER_CAPABILITY_IDS: readonly string[] = Object.keys(ADAPTER_CAPABILITIES)

/** 只取診斷需要的部分，避免 diagnostics 相依整個適配器模組（含 puppeteer）。 */
export interface CapabilityDeclaringAdapter {
  readonly siteName: string
  readonly requiredCapabilities?: readonly string[]
}

/**
 * 依已解析到的網站適配器衍生爬取設定檔。
 *
 * 依 CONTEXT.md：網站適配器前置條件只在網址解析到該適配器後，才成為爬取設定檔
 * 的檢查項。未提供網址時不引入任何單一適配器的需求——否則爬純 HTTP 站點的人
 * 會因為缺少瀏覽器而被擋下。
 */
export function withAdapterCapabilities(
  profile: WorkflowProfile,
  adapter?: CapabilityDeclaringAdapter
): WorkflowProfile {
  if (!profile.includesCrawl) return profile

  const required = [...new Set(adapter?.requiredCapabilities ?? [])]
  const existing = new Set(profile.capabilities.map((capability) => capability.id))

  return {
    ...profile,
    capabilities: [
      ...profile.capabilities,
      ...required.filter((id) => !existing.has(id)).map(adapterCapability),
    ],
  }
}

/** 爬取設定檔的薄包裝，保留既有呼叫端的用法。 */
export function deriveCrawlProfile(
  adapter?: CapabilityDeclaringAdapter
): WorkflowProfile {
  return withAdapterCapabilities(CRAWL_PROFILE, adapter)
}

/**
 * 未知的能力 id 是開發者的疏忽。診斷不 import 適配器，因此擋不到這種宣告，
 * 只能讓它以可辨識的形式浮出來——探測會回 no-probe，評估層據此說明是內部
 * 設定缺漏而非使用者的環境問題。
 */
function adapterCapability(id: string): CapabilityRequirement {
  return ADAPTER_CAPABILITIES[id] ?? { id, label: id, whenMissing: 'blocked', remedy: '' }
}

const REGISTRY: readonly WorkflowProfile[] = [
  CRAWL_PROFILE,
  AUDIOBOOK_PROFILE,
  M4B_PROFILE,
  YOUTUBE_PROFILE,
  BACKUP_PROFILE,
]

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

// 能力目錄是靜態的，納入同一道防線：新增一項卻忘了註冊探測器，應在載入時就
// 失敗，而不是等到某個使用者剛好爬到那個站才拿到一則「內部設定缺漏」。
for (const [id, capability] of Object.entries(ADAPTER_CAPABILITIES)) {
  if (id !== capability.id) {
    throw new Error(`能力目錄的鍵 ${id} 與其 id ${capability.id} 不一致`)
  }
  if (!hasProbe(id)) {
    throw new Error(`適配器能力 ${id} 沒有對應的探測方式`)
  }
}

export const PROFILE_NAMES: readonly string[] = REGISTRY.map((profile) => profile.name)

export function getProfile(name: string): WorkflowProfile | undefined {
  return REGISTRY.find((profile) => profile.name === name)
}

export function allProfiles(): readonly WorkflowProfile[] {
  return REGISTRY
}
