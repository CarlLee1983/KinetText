#!/usr/bin/env bun
/**
 * CLI：從 audio/ 逐章 MP3 產生分卷 M4B 有聲書
 */

import path from 'node:path'
import { stat } from 'node:fs/promises'
import { M4BBuilderService } from '../src/core/services/M4BBuilderService'
import type { M4BBuildReport } from '../src/core/services/M4BBuilderService'
import { enforceStartup } from '../src/diagnostics/startup'

interface CliArgs {
  title?: string
  input?: string
  output?: string
  target: number
  bitrate: number
  artist?: string
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const raw = process.argv.slice(2)
  const parsed: Record<string, string | boolean> = {}
  for (const arg of raw) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.substring(2).split('=')
      parsed[k] = v ?? true
    }
  }
  return {
    title: parsed.title as string | undefined,
    input: parsed.input as string | undefined,
    output: parsed.output as string | undefined,
    target: parsed.target ? parseInt(parsed.target as string, 10) : 39600,
    bitrate: parsed.bitrate ? parseInt(parsed.bitrate as string, 10) : 256,
    artist: parsed.artist as string | undefined,
    dryRun: parsed['dry-run'] === true || parsed['dry-run'] === 'true',
  }
}

/** 若 output/<書>/cover.jpg|png 存在則回傳路徑 */
async function findCover(bookDir: string): Promise<string | undefined> {
  for (const name of ['cover.jpg', 'cover.png']) {
    const p = path.join(bookDir, name)
    try {
      await stat(p)
      return p
    } catch { /* 無此檔 */ }
  }
  return undefined
}

function formatReport(r: M4BBuildReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════',
    'M4B 有聲書建構報告',
    '═══════════════════════════════════════════════',
    `書名: ${r.bookTitle}`,
    `輸入: ${r.audioDir}`,
    `輸出: ${r.outputDir}`,
    `章節數: ${r.totalChapters}`,
    `卷數: ${r.totalVolumes}`,
    `成功: ${r.successCount}　失敗: ${r.failureCount}`,
    `乾運行: ${r.dryRun ? '是' : '否'}`,
    '',
  ]
  for (const v of r.volumes) {
    const status = v.error ? '❌' : (r.dryRun ? '•' : '✅')
    const dur = `${(v.estimatedDuration / 3600).toFixed(1)}h`
    const err = v.error ? ` — ${v.error}` : ''
    lines.push(`  ${status} 第${v.volumeIndex}卷　${v.chapterCount} 章　~${dur}　${path.basename(v.outputPath)}${err}`)
  }
  lines.push('')
  lines.push('═══════════════════════════════════════════════', '')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = parseArgs()
  let audioDir = args.input
  let outputDir = args.output
  let coverPath: string | undefined

  if (args.title) {
    const bookDir = path.join(process.cwd(), 'output', args.title)
    audioDir = audioDir ?? path.join(bookDir, 'audio')
    outputDir = outputDir ?? path.join(bookDir, 'm4b')
    coverPath = await findCover(bookDir)
  }

  if (!audioDir || !outputDir) {
    console.error('Usage: bun run build-m4b --title=<書名> [--target=秒] [--bitrate=kbps] [--artist=名] [--dry-run]')
    console.error('   或: bun run build-m4b --input=<audioDir> --output=<m4bDir> [...]')
    process.exit(1)
  }

  // 啟動前檢查：ffmpeg 沒有替代路徑，缺席時不該讓流程跑到一半才失敗。
  // dry-run 只計算時長與分卷（M4BBuilderService 在呼叫 ffmpeg 前就返回），
  // 因此與 backup、yt-pipeline 同規則略過。
  if (!args.dryRun) {
    await enforceStartup('m4b')
  }

  const svc = new M4BBuilderService()
  const bookTitle = args.title ?? path.basename(path.dirname(outputDir))
  try {
    const report = await svc.build({
      audioDir, outputDir, bookTitle,
      targetSeconds: args.target, bitrate: args.bitrate,
      artist: args.artist, coverPath, dryRun: args.dryRun,
    })
    console.log(formatReport(report))
    process.exit(report.failureCount > 0 ? 1 : 0)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`\n錯誤: ${msg}\n`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[Error] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
