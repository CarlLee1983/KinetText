#!/usr/bin/env bun
/**
 * bench_convert.ts - 音頻轉換性能基準測試 CLI
 *
 * 對比 Bun FFmpeg 後端與 Go kinetitext-audio 後端的轉換速度。
 * 生成性能報告到 .planning/phases/06-audio-convert-go/PERF_REPORT.md
 *
 * 使用方式:
 *   bun run bench:convert
 *   bun run scripts/bench_convert.ts
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { AudioConvertBenchmark } from '../src/tests/integration/PerformanceBench'

const REPORT_DIR = join(import.meta.dir, '../.planning/phases/06-audio-convert-go')
const REPORT_PATH = join(REPORT_DIR, 'PERF_REPORT.md')

async function main(): Promise<void> {
  console.log('音頻轉換性能基準測試')
  console.log('===================')
  console.log('後端: Bun FFmpeg-Simplified vs Go kinetitext-audio')
  console.log('格式: WAV / AAC / OGG / FLAC → MP3')
  console.log('')

  const benchmark = new AudioConvertBenchmark()

  console.log('開始執行基準測試...')
  const startMs = Date.now()
  const report = await benchmark.benchmarkGoVsBun()
  const totalMs = Date.now() - startMs

  // 顯示結果摘要
  console.log('')
  console.log('=== 測試完成 ===')
  console.log(`執行時間: ${totalMs}ms`)
  console.log(`Go 後端可用: ${report.goAvailable ? '是' : '否'}`)

  if (report.goAvailable && report.summary.length > 0) {
    console.log('')
    console.log('性能對比:')
    for (const s of report.summary) {
      const goalIcon = s.goalMet ? '✅' : '❌'
      console.log(
        `  ${s.format.toUpperCase()}: Bun ${s.bunMs}ms → Go ${s.goMs}ms (${s.improvementPct >= 0 ? '+' : ''}${s.improvementPct}%) ${goalIcon}`
      )
    }
    console.log('')
    console.log(`平均提升: ${report.avgImprovementPct}%`)
    console.log(
      `性能目標 (30%+): ${report.performanceGoalMet ? '✅ 達成' : '❌ 未達成'}`
    )
  } else if (!report.goAvailable) {
    console.log('')
    console.log('⚠️  Go 二進制不可用，請先執行:')
    console.log('   cd ../kinetitext-go && make build')
  }

  // 生成 Markdown 報告
  const markdown = AudioConvertBenchmark.formatReport(report)

  // 確保目錄存在
  await mkdir(REPORT_DIR, { recursive: true })
  await Bun.write(REPORT_PATH, markdown)

  console.log('')
  console.log(`報告已生成: ${REPORT_PATH}`)
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`基準測試失敗: ${msg}`)
  process.exit(1)
})
