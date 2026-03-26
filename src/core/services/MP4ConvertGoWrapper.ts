/**
 * MP4ConvertGoWrapper - Bun 子進程層，調用 kinetitext-go 二進制
 *
 * 使用 JSON 序列化通過 subprocess stdin/stdout 與 Go 二進制通信。
 * 相比 FFI.cdef，subprocess JSON 方案更穩定、跨平台兼容性更好。
 *
 * IPC 協議: JSON via subprocess stdin/stdout
 * 二進制路徑: ../../../kinetitext-go/bin/kinetitext-mp4convert
 */

import { join } from 'node:path'
import { createLogger } from '../utils/logger'
import { MP4Metadata } from '../types/audio'

const logger = createLogger('MP4ConvertGoWrapper')

/** Go 側 MP4MetadataGo 格式 (snake_case) */
interface GoMP4Metadata {
  title?: string
  artist?: string
  album?: string
  date?: string
  genre?: string
  track_number?: number
  comment?: string
}

/** Go 側 MP4ConvertRequest 格式 (snake_case) */
interface GoMP4ConvertRequest {
  input_file: string
  output_file: string
  bitrate: number
  metadata?: GoMP4Metadata
}

/** Go 側 MP4ConvertResponse 格式 (snake_case) */
interface GoMP4ConvertResponse {
  success: boolean
  output_file?: string
  error?: string
}

/** Bun 側 MP4ConvertRequest 格式 (camelCase) */
export interface MP4ConvertGoRequest {
  inputFile: string
  outputFile: string
  bitrate: number
  metadata?: Readonly<MP4Metadata>
}

/** Bun 側 MP4ConvertResponse 格式 (camelCase) */
export interface MP4ConvertGoResponse {
  success: boolean
  outputFile?: string
  error?: string
}

/**
 * MP4ConvertGoWrapper - 靜態工廠類，管理 Go 子進程調用
 *
 * 使用 singleton 模式管理二進制路徑配置，確保路徑只初始化一次。
 */
export class MP4ConvertGoWrapper {
  // import.meta.dir = /Users/carl/Dev/Carl/KinetiText/src/core/services
  // 5 levels up → /Users/carl/Dev/Carl → kinetitext-go/bin/kinetitext-mp4convert
  private static goBinaryPath: string = join(
    import.meta.dir,
    '../../../../../kinetitext-go/bin/kinetitext-mp4convert'
  )

  /**
   * 初始化 Go 二進制路徑（可選，覆蓋預設值）
   * @param binaryPath Go 二進制的絕對路徑
   * @throws Error 如果二進制文件不存在
   */
  static async init(binaryPath: string): Promise<void> {
    const file = Bun.file(binaryPath)
    const exists = await file.exists()
    if (!exists) {
      throw new Error(`Go 二進制文件不存在: ${binaryPath}`)
    }
    MP4ConvertGoWrapper.goBinaryPath = binaryPath
    logger.info({ binaryPath }, 'MP4ConvertGoWrapper 初始化完成')
  }

  /**
   * 執行 MP4 轉換（調用 Go kinetitext-mp4convert 二進制）
   * @param req 轉換請求
   * @returns Promise<MP4ConvertGoResponse>
   */
  static async convertMP4(req: MP4ConvertGoRequest): Promise<MP4ConvertGoResponse> {
    try {
      // 轉換元數據格式：Bun camelCase → Go snake_case
      let goMetadata: GoMP4Metadata | undefined
      if (req.metadata) {
        goMetadata = {
          title: req.metadata.title,
          artist: req.metadata.artist,
          album: req.metadata.album,
          date: req.metadata.date,
          genre: req.metadata.genre,
          track_number: req.metadata.trackNumber,
          comment: req.metadata.comment,
        }
        // 移除 undefined 欄位
        Object.keys(goMetadata).forEach(key => {
          if ((goMetadata as any)[key] === undefined) {
            delete (goMetadata as any)[key]
          }
        })
        if (Object.keys(goMetadata).length === 0) {
          goMetadata = undefined
        }
      }

      // 轉換為 Go 側 snake_case 格式
      const goReq: GoMP4ConvertRequest = {
        input_file: req.inputFile,
        output_file: req.outputFile,
        bitrate: req.bitrate,
        metadata: goMetadata,
      }

      const inputJson = JSON.stringify(goReq)

      // 啟動 Go 子進程
      // Bun.spawn stdin:'pipe' → proc.stdin 為 FileSink (write/end 直接調用)
      const proc = Bun.spawn([MP4ConvertGoWrapper.goBinaryPath], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })

      // 寫入 JSON 輸入並關閉 stdin (Bun FileSink API)
      proc.stdin.write(inputJson)
      proc.stdin.end()

      // 等待進程完成並收集輸出
      const [outputText, stderrText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      if (exitCode !== 0) {
        logger.error(
          { exitCode, stderr: stderrText, req },
          'Go 二進制非零退出碼'
        )
        return {
          success: false,
          error: `Go 二進制錯誤 (退出碼 ${exitCode}): ${stderrText}`,
        }
      }

      const trimmed = outputText.trim()
      if (!trimmed) {
        return {
          success: false,
          error: 'Go 二進制無輸出',
        }
      }

      // 解析 Go 回應 JSON
      const goResp = JSON.parse(trimmed) as GoMP4ConvertResponse

      // 轉換為 Bun 側 camelCase 格式
      return {
        success: goResp.success,
        outputFile: goResp.output_file,
        error: goResp.error,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error: message, req }, 'MP4ConvertGoWrapper 調用失敗')
      return {
        success: false,
        error: `Wrapper 錯誤: ${message}`,
      }
    }
  }

  /**
   * 取得當前 Go 二進制路徑
   */
  static getBinaryPath(): string {
    return MP4ConvertGoWrapper.goBinaryPath
  }

  /**
   * 驗證 Go 二進制是否存在且可執行
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const file = Bun.file(MP4ConvertGoWrapper.goBinaryPath)
      return await file.exists()
    } catch {
      return false
    }
  }
}

export default MP4ConvertGoWrapper
