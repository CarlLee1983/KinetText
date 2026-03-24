#!/usr/bin/env bun
/**
 * CLI for MP3→M4A conversion pipeline
 * Orchestrates the complete audio processing workflow
 */

import { MP4Pipeline } from '../src/core/services/MP4Pipeline'
import { MP4ConversionService } from '../src/core/services/MP4ConversionService'
import { AudioMergeService } from '../src/core/services/AudioMergeService'
import { DurationService } from '../src/core/services/DurationService'
import { RetryService } from '../src/core/services/RetryService'
import { AudioErrorClassifier } from '../src/core/services/AudioErrorClassifier'
import { loadMP4Config } from '../src/core/config/MP4ConversionConfig'
import { getLogger } from '../src/core/utils/logger'
import type { MP4Metadata, MP4PipelineReport } from '../src/core/types/audio'

const logger = getLogger('mp3_to_mp4')

/**
 * CLI argument structure
 */
interface CliArgs {
  input: string
  output: string
  metadata?: string
  dryRun?: boolean
}

/**
 * Parse command-line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const parsed: Record<string, string | boolean> = {}

  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=')
      parsed[key] = value ?? true
    }
  })

  if (!parsed.input || !parsed.output) {
    console.error('Usage: bun scripts/mp3_to_mp4.ts --input=/path --output=/path [--metadata=/path] [--dry-run]')
    console.error('')
    console.error('Options:')
    console.error('  --input=/path        Directory containing merged MP3 files')
    console.error('  --output=/path       Directory for output M4A files')
    console.error('  --metadata=/path     JSON file with metadata map (optional)')
    console.error('  --dry-run            Preview conversion without executing FFmpeg')
    process.exit(1)
  }

  return {
    input: parsed.input as string,
    output: parsed.output as string,
    metadata: parsed.metadata as string | undefined,
    dryRun: parsed['dry-run'] === true || parsed['dry-run'] === 'true'
  }
}

/**
 * Format pipeline report as human-readable Chinese output
 */
function formatReport(report: MP4PipelineReport): string {
  const timestamp = new Date(report.timestamp).toLocaleString('zh-TW')
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════',
    'MP3 → M4A 轉換報告',
    '═══════════════════════════════════════════════',
    `時間戳: ${timestamp}`,
    `輸入目錄: ${report.inputDirectory}`,
    `輸出目錄: ${report.outputDirectory}`,
    `總檔案數: ${report.totalFiles}`,
    `成功: ${report.successCount}`,
    `失敗: ${report.failureCount}`,
    `乾運行模式: ${report.dryRun ? '是' : '否'}`,
    ''
  ]

  if (report.dryRun) {
    lines.push('預覽模式 — 未執行實際轉換')
    lines.push('若要開始轉換，請執行:')
    lines.push(`  bun scripts/mp3_to_mp4.ts --input=${report.inputDirectory} --output=${report.outputDirectory}`)
    lines.push('')
  }

  if (report.errors.length > 0) {
    lines.push('錯誤:')
    report.errors.forEach(err => {
      lines.push(`  • ${err}`)
    })
    lines.push('')
  }

  if (report.results.length > 0 && !report.dryRun) {
    lines.push('轉換結果:')
    report.results.forEach((result, idx) => {
      const status = result.error ? '❌' : '✅'
      const basename = result.inputPath.split('/').pop() ?? result.inputPath
      const duration = result.duration ? `(${Math.round(result.duration)}s)` : ''
      const errMsg = result.error ? ` — ${result.error}` : ''
      lines.push(`  ${status} [${idx + 1}] ${basename} ${duration}${errMsg}`)
    })
    lines.push('')
  }

  if (report.successCount > 0 && !report.dryRun) {
    lines.push(`成功生成 ${report.successCount} 個 M4A 檔案至: ${report.outputDirectory}`)
    lines.push('')
  }

  lines.push('═══════════════════════════════════════════════')
  lines.push('')

  return lines.join('\n')
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  try {
    const args = parseArgs()
    logger.info({ args }, 'Starting MP3→M4A conversion pipeline')

    // Load configuration
    const config = await loadMP4Config()
    logger.info({ config }, 'Configuration loaded')

    // Load metadata if provided
    let metadataMap: Record<string, MP4Metadata> | undefined
    if (args.metadata) {
      const metadataFile = Bun.file(args.metadata)
      if (await metadataFile.exists()) {
        try {
          const json = await metadataFile.json()
          metadataMap = json
          logger.info({ count: Object.keys(metadataMap).length }, 'Loaded metadata map')
        } catch (error) {
          logger.warn({ file: args.metadata, error }, 'Failed to parse metadata JSON')
        }
      } else {
        logger.warn({ file: args.metadata }, 'Metadata file not found, proceeding without')
      }
    }

    // Initialize services
    const retryService = new RetryService()
    const errorClassifier = new AudioErrorClassifier()
    const durationService = new DurationService()
    const audioMergeService = new AudioMergeService()
    const mp4ConversionService = new MP4ConversionService(
      config,
      retryService,
      errorClassifier
    )

    // Create and execute pipeline
    const pipeline = new MP4Pipeline(
      audioMergeService,
      mp4ConversionService,
      durationService,
      config
    )

    const report = await pipeline.execute({
      mergedAudioDir: args.input,
      outputDir: args.output,
      metadataSource: metadataMap,
      dryRun: args.dryRun
    })

    // Print report
    console.log(formatReport(report))

    // Exit with appropriate code
    process.exit(report.failureCount > 0 ? 1 : 0)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error }, 'Fatal error')
    console.error(`\n錯誤: ${msg}\n`)
    process.exit(1)
  }
}

// Execute main
main()
