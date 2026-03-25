/**
 * 配置 AudioConvertGoWrapper 的設定選項
 * 控制 Go 二進制路徑、超時時間和並行度
 */

import { z } from 'zod'

export const AudioConvertGoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  // 預設路徑會在執行時由 AudioConvertGoWrapper 設定
  goBinaryPath: z.string().default('kinetitext-go/bin/kinetitext-audio'),
  timeout: z.number().int().min(1000).default(60000), // 60 秒
  maxConcurrency: z.number().int().min(1).max(16).default(4),
})

export type AudioConvertGoConfig = z.infer<typeof AudioConvertGoConfigSchema>

/**
 * 建立預設配置，支援環境變數覆蓋
 */
export function createAudioConvertGoConfig(
  overrides: Partial<AudioConvertGoConfig> = {}
): AudioConvertGoConfig {
  return AudioConvertGoConfigSchema.parse({
    enabled: process.env.AUDIO_GO_ENABLED !== 'false',
    goBinaryPath: process.env.AUDIO_GO_BINARY_PATH ?? undefined,
    timeout: process.env.AUDIO_GO_TIMEOUT_MS
      ? parseInt(process.env.AUDIO_GO_TIMEOUT_MS, 10)
      : undefined,
    maxConcurrency: process.env.AUDIO_GO_MAX_CONCURRENCY
      ? parseInt(process.env.AUDIO_GO_MAX_CONCURRENCY, 10)
      : undefined,
    ...overrides,
  })
}
