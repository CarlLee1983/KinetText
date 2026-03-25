/**
 * DurationGoWrapper - Bun 子進程層，調用 kinetitext-go 二進制
 *
 * 使用 JSON 序列化通過 subprocess stdin/stdout 與 Go 二進制通信。
 * 相比 FFI.cdef，subprocess JSON 方案更穩定、跨平台兼容性更好。
 *
 * IPC 協議: JSON via subprocess stdin/stdout
 * 二進制路徑: ../../../kinetitext-go/bin/kinetitext-duration
 */

import { join } from 'node:path'
import { createLogger } from '../utils/logger'
import type { DurationGoConfig } from '../../config/DurationGoConfig'

const logger = createLogger('duration-go')

/** Go 側 DurationRequest 型別（JSON）- snake_case */
interface GoReadMetadataRequest {
  file_paths: string[]
  concurrency?: number
}

/** Go 側 DurationResponse 型別（JSON）- snake_case */
interface GoReadMetadataResponse {
  success: number
  error?: string
  durations?: Record<string, number>
}

/**
 * DurationGoWrapper - Bun → Go subprocess JSON IPC
 *
 * 調用 kinetitext-go/bin/kinetitext-duration 並發讀取元數據
 * 支援 FLAC (go-flac) + MP3/AAC/OGG (ffprobe fallback)
 */
export class DurationGoWrapper {
  private static goBinary: string = ''
  private static config: DurationGoConfig | null = null

  /**
   * 初始化 Go 二進制路徑和配置
   * @param goBinaryPath Go 二進制的絕對或相對路徑
   * @param config DurationGoConfig 設定
   */
  static init(goBinaryPath: string, config: DurationGoConfig): void {
    this.goBinary = goBinaryPath
    this.config = config
    logger.info({ goBinaryPath }, 'DurationGoWrapper initialized')
  }

  /**
   * 批量讀取元數據（Go 版本）
   * @param filePaths 檔案路徑陣列
   * @param concurrency 並發工作數（可選，預設 config.concurrency）
   * @returns Map<path, duration>，路徑 → 秒數
   * @throws 若 Go binary 不可用或 IPC 失敗
   */
  static async readMetadata(
    filePaths: ReadonlyArray<string>,
    concurrency?: number
  ): Promise<Map<string, number>> {
    if (!filePaths || filePaths.length === 0) {
      return new Map()
    }

    if (!this.config) {
      throw new Error('DurationGoWrapper not initialized')
    }

    try {
      // 檢查 Go binary 存在
      const file = Bun.file(this.goBinary)
      const exists = await file.exists()
      if (!exists) {
        throw new Error(`Go binary not found: ${this.goBinary}`)
      }

      // 準備 JSON 請求
      const concurrencyValue = Math.min(
        concurrency ?? this.config.concurrency,
        16
      )
      const request: GoReadMetadataRequest = {
        file_paths: Array.from(filePaths),
        concurrency: concurrencyValue,
      }

      const inputJson = JSON.stringify(request)

      // 執行 Go 程序
      const proc = Bun.spawn([this.goBinary], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })

      // 寫入 stdin
      proc.stdin.write(inputJson)
      proc.stdin.end()

      // 等待完成並讀取 stdout/stderr
      const [outputText, errorText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      if (exitCode !== 0) {
        const errorMsg = errorText || outputText || 'unknown error'
        throw new Error(
          `Go process exited with code ${exitCode}: ${errorMsg}`
        )
      }

      // 解析 Go 回應
      const response: GoReadMetadataResponse = JSON.parse(outputText)

      // 記錄成功/失敗
      logger.info(
        {
          success: response.success,
          total: filePaths.length,
          error: response.error,
        },
        'Go metadata read completed'
      )

      // 轉換回 Map<string, number>
      const result = new Map<string, number>()
      if (response.durations) {
        for (const [path, duration] of Object.entries(response.durations)) {
          result.set(path, duration)
        }
      }

      // 若有錯誤但部分成功，記錄警告但不拋錯
      if (response.error && response.success > 0) {
        logger.warn(
          { error: response.error },
          'Partial metadata read success'
        )
      }

      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error({ error: msg }, 'Go metadata read failed')
      // 拋出錯誤給調用者，讓 DurationService 決定是否 fallback
      throw error
    }
  }

  /**
   * 檢查 Go binary 是否存在且可用
   */
  static async isAvailable(): Promise<boolean> {
    try {
      if (!this.goBinary) return false
      const file = Bun.file(this.goBinary)
      return await file.exists()
    } catch {
      return false
    }
  }

  /**
   * 取得當前 Go 二進制路徑
   */
  static getBinaryPath(): string {
    return this.goBinary
  }
}

/**
 * 初始化 DurationGoWrapper（在 CrawlerEngine 或 main.ts 中調用）
 */
export function initDurationGoBackend(
  goBinaryPath: string,
  config: DurationGoConfig
): void {
  DurationGoWrapper.init(goBinaryPath, config)
}

export default DurationGoWrapper
