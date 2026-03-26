/**
 * 配置 MP4ConvertGoWrapper 的設定選項
 * 控制 Go 二進制路徑、超時時間
 */

import { z } from 'zod'

export const MP4ConvertGoConfigSchema = z.object({
  enabled: z.boolean().default(false),
  // 預設路徑會在執行時由 MP4ConvertGoWrapper 設定
  goBinaryPath: z.string().default('kinetitext-go/bin/kinetitext-mp4convert'),
  timeout: z.number().int().min(1000).max(300000).default(60000), // 60 秒
})

export type MP4ConvertGoConfig = z.infer<typeof MP4ConvertGoConfigSchema>

/**
 * 建立預設配置，支援環境變數覆蓋
 */
export function createMP4ConvertGoConfig(
  overrides: Partial<MP4ConvertGoConfig> = {}
): MP4ConvertGoConfig {
  return MP4ConvertGoConfigSchema.parse({
    enabled: process.env.MP4_GO_ENABLED === 'true',
    goBinaryPath: process.env.MP4_GO_BINARY_PATH ?? undefined,
    timeout: process.env.MP4_GO_TIMEOUT_MS
      ? parseInt(process.env.MP4_GO_TIMEOUT_MS, 10)
      : undefined,
    ...overrides,
  })
}
