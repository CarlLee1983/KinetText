/**
 * AudioConvertGoWrapper - Bun 子進程層，調用 kinetitext-go 二進制
 *
 * 使用 JSON 序列化通過 subprocess stdin/stdout 與 Go 二進制通信。
 * 相比 FFI.cdef，subprocess JSON 方案更穩定、跨平台兼容性更好。
 *
 * IPC 協議: JSON via subprocess stdin/stdout
 * 二進制路徑: ../../../kinetitext-go/bin/kinetitext-audio
 */

import { join } from 'node:path'
import { createLogger } from '../utils/logger'

const logger = createLogger('AudioConvertGoWrapper')

/** Go 側 AudioConvertRequest 格式 (snake_case) */
interface GoAudioConvertRequest {
  input_file: string
  output_file: string
  format: string
  bitrate: number
}

/** Go 側 AudioConvertResponse 格式 (snake_case) */
interface GoAudioConvertResponse {
  success: boolean
  output_file?: string
  duration?: number
  error?: string
}

/** Bun 側 AudioConvertRequest 格式 (camelCase) */
export interface AudioConvertGoRequest {
  inputFile: string
  outputFile: string
  format: string // mp3, m4a, aac, wav, ogg, flac
  bitrate?: number // 128, 192, 256, 320
}

/** Bun 側 AudioConvertResponse 格式 (camelCase) */
export interface AudioConvertGoResponse {
  success: boolean
  outputFile?: string
  duration?: number
  error?: string
}

/**
 * AudioConvertGoWrapper - 靜態工廠類，管理 Go 子進程調用
 *
 * 使用 singleton 模式管理二進制路徑配置，確保路徑只初始化一次。
 */
export class AudioConvertGoWrapper {
  // import.meta.dir = /Users/carl/Dev/Carl/KinetiText/src/core/services
  // 5 levels up → /Users/carl/Dev/Carl → kinetitext-go/bin/kinetitext-audio
  private static goBinaryPath: string = join(
    import.meta.dir,
    '../../../../../kinetitext-go/bin/kinetitext-audio'
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
    AudioConvertGoWrapper.goBinaryPath = binaryPath
    logger.info({ binaryPath }, 'AudioConvertGoWrapper 初始化完成')
  }

  /**
   * 執行音頻轉換（調用 Go kinetitext-audio 二進制）
   * @param req 轉換請求
   * @returns Promise<AudioConvertGoResponse>
   */
  static async convert(req: AudioConvertGoRequest): Promise<AudioConvertGoResponse> {
    try {
      // 轉換為 Go 側 snake_case 格式
      const goReq: GoAudioConvertRequest = {
        input_file: req.inputFile,
        output_file: req.outputFile,
        format: req.format,
        bitrate: req.bitrate ?? 192,
      }

      const inputJson = JSON.stringify(goReq)

      // 啟動 Go 子進程
      // Bun.spawn stdin:'pipe' → proc.stdin 為 FileSink (write/end 直接調用)
      const proc = Bun.spawn([AudioConvertGoWrapper.goBinaryPath], {
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
      const goResp = JSON.parse(trimmed) as GoAudioConvertResponse

      // 轉換為 Bun 側 camelCase 格式
      return {
        success: goResp.success,
        outputFile: goResp.output_file,
        duration: goResp.duration,
        error: goResp.error,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error({ error: message, req }, 'AudioConvertGoWrapper 調用失敗')
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
    return AudioConvertGoWrapper.goBinaryPath
  }

  /**
   * 驗證 Go 二進制是否存在且可執行
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const file = Bun.file(AudioConvertGoWrapper.goBinaryPath)
      return await file.exists()
    } catch {
      return false
    }
  }
}

export default AudioConvertGoWrapper
