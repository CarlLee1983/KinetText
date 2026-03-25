/**
 * 設定 DurationGoWrapper 的選項
 * 控制 Go 二進制路徑、超時時間、並行度和單檔案超時
 */

import { z } from 'zod'

export const DurationGoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  goBinaryPath: z
    .string()
    .default('../../../kinetitext-go/bin/kinetitext-duration'),
  timeout: z.number().int().min(5000).default(30000), // batch timeout in ms
  concurrency: z.number().int().min(1).max(16).default(4),
  perFileTimeout: z.number().int().default(5000), // per-file timeout in ms
})

export type DurationGoConfig = z.infer<typeof DurationGoConfigSchema>

export const defaultDurationGoConfig: DurationGoConfig = {
  enabled: true,
  goBinaryPath: '../../../kinetitext-go/bin/kinetitext-duration',
  timeout: 30000,
  concurrency: 4,
  perFileTimeout: 5000,
}

/**
 * 建立預設配置，支援環境變數覆蓋
 */
export function createDurationGoConfig(
  overrides: Partial<DurationGoConfig> = {}
): DurationGoConfig {
  return DurationGoConfigSchema.parse({
    enabled: process.env.DURATION_GO_ENABLED !== 'false',
    goBinaryPath:
      process.env.DURATION_GO_BINARY_PATH ?? undefined,
    timeout: process.env.DURATION_GO_TIMEOUT_MS
      ? parseInt(process.env.DURATION_GO_TIMEOUT_MS, 10)
      : undefined,
    concurrency: process.env.DURATION_GO_CONCURRENCY
      ? parseInt(process.env.DURATION_GO_CONCURRENCY, 10)
      : undefined,
    ...overrides,
  })
}
