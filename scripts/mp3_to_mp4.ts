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
import { RetryConfig } from '../src/config/RetryConfig'
import { AudioErrorClassifier } from '../src/core/services/AudioErrorClassifier'
import { loadMP4Config, type MP4ConversionConfig } from '../src/core/config/MP4ConversionConfig'
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
  youtube?: boolean
  cover?: string
}

function applyYoutubeConfig(base: MP4ConversionConfig, args: CliArgs): MP4ConversionConfig {
  if (!args.youtube && !args.cover) return base
  return {
    ...base,
    outputFormat: 'mp4',
    videoBackground: args.cover ? 'image' : 'black',
    coverImagePath: args.cover ?? base.coverImagePath,
  }
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

  const usageLines = [
    'Usage: bun run to-mp4 --input=/path --output=/path [options]',
    '       bun run to-youtube --input=/path --output=/path [options]',
    '',
    'Options:',
    '  --help, -h           Show help',
    '  --input=/path        Directory containing MP3 files',
    '  --output=/path       Directory for output files',
    '  --metadata=/path     JSON metadata map (optional)',
    '  --youtube            Output H.264+AAC .mp4 for YouTube (black video)',
    '  --cover=/path.jpg    Use cover image as video (implies --youtube)',
    '  --dry-run            Preview without FFmpeg',
    '',
    'YouTube mode env (alternative):',
    '  MP4_OUTPUT_FORMAT=mp4 MP4_VIDEO_BACKGROUND=black bun run to-mp4 ...',
  ]

  // 顯式 --help/-h：印說明到 stdout 並正常結束（exit 0）
  if (parsed.help || args.includes('-h')) {
    console.log(usageLines.join('\n'))
    process.exit(0)
  }

  if (!parsed.input || !parsed.output) {
    console.error(usageLines.join('\n'))
    process.exit(1)
  }

  return {
    input: parsed.input as string,
    output: parsed.output as string,
    metadata: parsed.metadata as string | undefined,
    dryRun: parsed['dry-run'] === true || parsed['dry-run'] === 'true',
    youtube: parsed.youtube === true || parsed.youtube === 'true',
    cover: parsed.cover as string | undefined,
  }
}

/**
 * Format pipeline report as human-readable Chinese output
 */
function formatReport(report: MP4PipelineReport, youtube: boolean): string {
  const timestamp = new Date(report.timestamp).toLocaleString('zh-TW')
  const formatLabel = youtube ? 'MP3 → YouTube MP4' : 'MP3 → M4A'
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════',
    formatLabel + ' 轉換報告',
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
    const ext = youtube ? 'MP4' : 'M4A'
    lines.push(`成功生成 ${report.successCount} 個 ${ext} 檔案至: ${report.outputDirectory}`)
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
    const youtube = Boolean(args.youtube || args.cover)
    logger.info({ args, youtube }, 'Starting MP3 conversion pipeline')

    const config = applyYoutubeConfig(await loadMP4Config(), args)
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
    const retryService = new RetryService(new RetryConfig({
      maxRetries: 2,
      timeoutMs: 3_600_000,
      operationTimeoutMs: 10_800_000
    }))
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
    console.log(formatReport(report, youtube))

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
