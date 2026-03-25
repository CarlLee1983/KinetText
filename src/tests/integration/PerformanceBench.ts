/**
 * 性能基準測試框架
 * 對比 Bun FFmpeg-Simplified 與 Go kinetitext-audio 後端在不同格式的轉換速度
 *
 * 使用方式:
 *   const bench = new AudioConvertBenchmark()
 *   const report = await bench.benchmarkGoVsBun()
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { $ } from 'bun'
import { AudioConvertService } from '../../core/services/AudioConvertService'
import { AudioConvertGoWrapper } from '../../core/services/AudioConvertGoWrapper'
import { AudioConvertConfig } from '../../config/AudioConvertConfig'
import { createLogger } from '../../core/utils/logger'

const logger = createLogger('PerformanceBench')

/** Go 二進制路徑 (相對於本文件: src/tests/integration/) */
const GO_BINARY_PATH = join(
  import.meta.dir,
  '../../../../kinetitext-go/bin/kinetitext-audio'
)

/** 每個格式執行的測試輪次（取平均值） */
const BENCH_ROUNDS = 3

/** 測試音頻時長（秒） */
const BENCH_AUDIO_SECS = 5

/** 支持測試的音頻格式 */
const BENCH_FORMATS = ['wav', 'aac', 'ogg', 'flac'] as const
type BenchFormat = typeof BENCH_FORMATS[number]

/** 單次測試結果 */
export interface BenchmarkRun {
  readonly round: number
  readonly durationMs: number
  readonly success: boolean
  readonly error?: string
}

/** 單個後端 + 格式的聚合結果 */
export interface BenchmarkResult {
  readonly backend: 'bun' | 'go'
  readonly format: BenchFormat
  readonly rounds: readonly BenchmarkRun[]
  readonly avgMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly successRate: number
}

/** 完整基準測試報告 */
export interface BenchmarkReport {
  readonly timestamp: string
  readonly goAvailable: boolean
  readonly results: readonly BenchmarkResult[]
  readonly summary: readonly {
    readonly format: BenchFormat
    readonly bunMs: number
    readonly goMs: number
    readonly improvementPct: number
    readonly goalMet: boolean
  }[]
  readonly avgImprovementPct: number
  readonly performanceGoalMet: boolean
}

/**
 * 音頻轉換後端性能基準測試工具
 *
 * 為每個支持的輸入格式 (WAV/AAC/OGG/FLAC) 分別以 Bun 和 Go 後端各轉換
 * BENCH_ROUNDS 輪，計算平均耗時與改善百分比。
 */
export class AudioConvertBenchmark {
  private tmpDir: string = ''
  private goAvailable = false

  /**
   * 執行完整基準測試，對比 Bun vs Go 後端
   * @returns BenchmarkReport 含完整統計數據
   */
  async benchmarkGoVsBun(): Promise<BenchmarkReport> {
    this.tmpDir = await mkdtemp(join(tmpdir(), 'kinetitext-bench-'))

    try {
      // 直接檢查指定路徑的 Go 二進制可用性
      this.goAvailable = await Bun.file(GO_BINARY_PATH).exists()

      if (this.goAvailable) {
        await AudioConvertGoWrapper.init(GO_BINARY_PATH)
        logger.info({ path: GO_BINARY_PATH }, 'Go 後端已初始化')
      } else {
        logger.warn({ path: GO_BINARY_PATH }, 'Go 二進制不可用，僅執行 Bun 基準測試')
      }

      // 生成測試音頻文件
      const inputFiles = await this.generateTestAudio()

      // 執行基準測試
      const results: BenchmarkResult[] = []

      for (const format of BENCH_FORMATS) {
        const inputFile = inputFiles[format]
        if (!inputFile) {
          logger.warn({ format }, '跳過格式（生成失敗）')
          continue
        }

        // Bun 後端測試
        const bunResult = await this.benchmarkBackend('bun', format, inputFile)
        results.push(bunResult)

        // Go 後端測試（若可用）
        if (this.goAvailable) {
          const goResult = await this.benchmarkBackend('go', format, inputFile)
          results.push(goResult)
        }
      }

      return this.buildReport(results)
    } finally {
      // 清理臨時目錄
      await rm(this.tmpDir, { recursive: true, force: true })
    }
  }

  /**
   * 對單個後端 + 格式組合執行多輪測試
   */
  private async benchmarkBackend(
    backend: 'bun' | 'go',
    format: BenchFormat,
    inputFile: string
  ): Promise<BenchmarkResult> {
    const runs: BenchmarkRun[] = []

    for (let round = 1; round <= BENCH_ROUNDS; round++) {
      const outputFile = join(
        this.tmpDir,
        `bench_${backend}_${format}_r${round}.mp3`
      )

      const start = performance.now()
      let success = true
      let error: string | undefined

      try {
        if (backend === 'go') {
          const resp = await AudioConvertGoWrapper.convert({
            inputFile,
            outputFile,
            format: 'mp3',
            bitrate: 128,
          })
          if (!resp.success) {
            throw new Error(resp.error ?? 'Go conversion failed')
          }
        } else {
          const config = new AudioConvertConfig({ bitrate: '128k' })
          const service = new AudioConvertService(config)
          await service.convertToMp3(inputFile, outputFile)
        }
      } catch (err) {
        success = false
        error = err instanceof Error ? err.message : String(err)
        logger.error({ backend, format, round, error }, '轉換失敗')
      }

      const durationMs = Math.round(performance.now() - start)
      runs.push({ round, durationMs, success, error })
    }

    const successfulRuns = runs.filter(r => r.success)
    const avgMs =
      successfulRuns.length > 0
        ? Math.round(
            successfulRuns.reduce((sum, r) => sum + r.durationMs, 0) /
              successfulRuns.length
          )
        : 0
    const minMs =
      successfulRuns.length > 0
        ? Math.min(...successfulRuns.map(r => r.durationMs))
        : 0
    const maxMs =
      successfulRuns.length > 0
        ? Math.max(...successfulRuns.map(r => r.durationMs))
        : 0
    const successRate = runs.length > 0 ? successfulRuns.length / runs.length : 0

    return {
      backend,
      format,
      rounds: runs,
      avgMs,
      minMs,
      maxMs,
      successRate,
    }
  }

  /**
   * 生成各格式測試音頻文件（5 秒靜音）
   */
  private async generateTestAudio(): Promise<Partial<Record<BenchFormat, string>>> {
    const files: Partial<Record<BenchFormat, string>> = {}

    const generateOps: Array<[BenchFormat, () => Promise<string>]> = [
      [
        'wav',
        async () => {
          const path = join(this.tmpDir, 'bench_input.wav')
          await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${BENCH_AUDIO_SECS} ${path}`.quiet().nothrow()
          return path
        },
      ],
      [
        'aac',
        async () => {
          const path = join(this.tmpDir, 'bench_input.aac')
          await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${BENCH_AUDIO_SECS} -codec:a aac ${path}`.quiet().nothrow()
          return path
        },
      ],
      [
        'ogg',
        async () => {
          const path = join(this.tmpDir, 'bench_input.ogg')
          await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${BENCH_AUDIO_SECS} -codec:a libopus ${path}`.quiet().nothrow()
          return path
        },
      ],
      [
        'flac',
        async () => {
          const path = join(this.tmpDir, 'bench_input.flac')
          await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${BENCH_AUDIO_SECS} ${path}`.quiet().nothrow()
          return path
        },
      ],
    ]

    for (const [format, generate] of generateOps) {
      try {
        const filePath = await generate()
        const exists = await Bun.file(filePath).exists()
        if (exists) {
          files[format] = filePath
        } else {
          logger.warn({ format }, '測試音頻生成失敗（文件不存在）')
        }
      } catch (err) {
        logger.warn({ format, err }, '測試音頻生成錯誤')
      }
    }

    return files
  }

  /**
   * 從原始結果構建完整報告
   */
  private buildReport(results: readonly BenchmarkResult[]): BenchmarkReport {
    const bunResults = new Map<BenchFormat, BenchmarkResult>()
    const goResults = new Map<BenchFormat, BenchmarkResult>()

    for (const r of results) {
      if (r.backend === 'bun') bunResults.set(r.format, r)
      else goResults.set(r.format, r)
    }

    const summary = BENCH_FORMATS
      .filter(fmt => bunResults.has(fmt) && goResults.has(fmt))
      .map(fmt => {
        const bun = bunResults.get(fmt)!
        const go = goResults.get(fmt)!
        const improvementPct =
          bun.avgMs > 0
            ? Math.round(((bun.avgMs - go.avgMs) / bun.avgMs) * 1000) / 10
            : 0
        return {
          format: fmt,
          bunMs: bun.avgMs,
          goMs: go.avgMs,
          improvementPct,
          goalMet: improvementPct >= 30,
        }
      })

    const avgImprovementPct =
      summary.length > 0
        ? Math.round(
            (summary.reduce((sum, s) => sum + s.improvementPct, 0) /
              summary.length) *
              10
          ) / 10
        : 0

    return {
      timestamp: new Date().toISOString(),
      goAvailable: this.goAvailable,
      results,
      summary,
      avgImprovementPct,
      performanceGoalMet: avgImprovementPct >= 30,
    }
  }

  /**
   * 將報告生成為 Markdown 文字
   */
  static formatReport(report: BenchmarkReport): string {
    const lines: string[] = [
      '# 性能基準測試報告',
      '',
      `**測試日期**: ${report.timestamp}`,
      `**Go 後端可用**: ${report.goAvailable ? '是' : '否'}`,
      '',
    ]

    if (report.goAvailable && report.summary.length > 0) {
      lines.push('## 概覽', '')
      lines.push('| 格式 | Bun 平均 | Go 平均 | 提升 | 目標達成 |')
      lines.push('|------|---------|--------|------|---------|')

      for (const s of report.summary) {
        const goalIcon = s.goalMet ? '✅' : '❌'
        lines.push(
          `| ${s.format.toUpperCase()} | ${s.bunMs}ms | ${s.goMs}ms | **${s.improvementPct}%** | ${goalIcon} |`
        )
      }

      lines.push('')
      lines.push(`**平均提升**: ${report.avgImprovementPct}%`)
      lines.push(
        `**性能目標 (30%+)**: ${report.performanceGoalMet ? '✅ 達成' : '❌ 未達成'}`
      )
      lines.push('')
    } else if (!report.goAvailable) {
      lines.push('## 概覽', '')
      lines.push('> ⚠️ Go 二進制不可用，僅顯示 Bun 基準數據。')
      lines.push('')
    }

    lines.push('## 詳細結果', '')
    lines.push('| 後端 | 格式 | 平均(ms) | 最小(ms) | 最大(ms) | 成功率 |')
    lines.push('|------|------|---------|---------|---------|-------|')

    for (const r of report.results) {
      const successPct = Math.round(r.successRate * 100)
      lines.push(
        `| ${r.backend} | ${r.format.toUpperCase()} | ${r.avgMs} | ${r.minMs} | ${r.maxMs} | ${successPct}% |`
      )
    }

    lines.push('')
    lines.push('## 詳細輪次數據', '')
    lines.push('| 後端 | 格式 | 輪次 | 耗時(ms) | 狀態 |')
    lines.push('|------|------|------|---------|------|')

    for (const r of report.results) {
      for (const run of r.rounds) {
        const status = run.success ? '✅' : `❌ ${run.error ?? ''}`
        lines.push(
          `| ${r.backend} | ${r.format.toUpperCase()} | ${run.round} | ${run.durationMs} | ${status} |`
        )
      }
    }

    return lines.join('\n')
  }
}

export default AudioConvertBenchmark
