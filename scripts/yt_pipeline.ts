#!/usr/bin/env bun
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { $ } from 'bun'
import {
  parseYtPipelineArgs,
  buildCrawlStep,
  buildAudiobookStep,
  buildMergeStep,
  pickNewBook,
  buildPartMp4Plans,
  shouldRetryFailed,
} from '../src/core/services/ytPipeline'
import { CoverGenerator } from '../src/core/services/CoverGenerator'
import { buildMP4WithImageCommand } from '../src/core/utils/ffmpeg-commands'

const HELP = `用法: bun run yt-pipeline <url> [選項]

選項:
  --target=<6h>        時長分段上限（秒/11h/660m）
  --bitrate=<256>      AAC 位元率 kbps
  --rate=<+0%>         TTS 語速
  --volume=<+0%>       TTS 音量
  --concurrency=<3>    TTS 併發
  --crawl-retries=<n>  爬取每章最大嘗試次數（預設 3）
  --crawl-concurrency=<n> 爬取併發（預設 5）
  --crawl-delay=<ms>   爬取退避延遲基數 ms（預設 2000）
  --tolerance=<%>      合併時長容差（預設 10）
  --no-retry-failed    爬完不自動補抓失敗章節（預設會補）
  --font=<path>        封面字型（預設 PingFang）
  --title=<書名>       指定書名（重跑接續時用）
  --resume             已存在產物跳過（預設開）
  --dry-run            只印計畫，不執行
  -h, --help           顯示說明`

const OUTPUT_ROOT = path.join(import.meta.dir, '..', 'output')

async function listBookDirs(): Promise<string[]> {
  try {
    const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function runScript(args: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return await proc.exited
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP)
    process.exit(argv.length === 0 ? 1 : 0)
  }

  const o = parseYtPipelineArgs(argv)

  if (o.dryRun) {
    const crawlOpts = { crawlRetries: o.crawlRetries, crawlConcurrency: o.crawlConcurrency, crawlDelay: o.crawlDelay }
    console.log('[Dry-run] 將執行:')
    console.log('  ①', buildCrawlStep(o.url, crawlOpts).join(' '))
    console.log(`  ↳ 補抓失敗章節: ${o.retryFailed ? '開啟' : '關閉'}`)
    console.log('  ② audiobook <書名> all', o.rate, o.volume, o.concurrency, 'false')
    console.log('  ③', buildMergeStep('output/<書名>', 'output/<書名>/merged', o.target, o.tolerance).join(' '))
    console.log('  ④ 逐段生成封面 + ffmpeg 出 mp4（bitrate ' + o.bitrate + '）')
    process.exit(0)
  }

  // ① 爬取（記錄前後書目錄差異以判定書名）
  const before = await listBookDirs()
  console.log('\n========== ① 爬取 ==========\n')
  let code = await runScript(buildCrawlStep(o.url, {
    crawlRetries: o.crawlRetries,
    crawlConcurrency: o.crawlConcurrency,
    crawlDelay: o.crawlDelay,
  }))
  if (code !== 0) return failAt('① 爬取', code)

  const after = await listBookDirs()
  let title: string
  try {
    title = pickNewBook(before, after, o.title)
  } catch (e) {
    console.error('\n❌ ' + (e instanceof Error ? e.message : String(e)))
    process.exit(1)
  }
  console.log(`\n📖 書名: ${title}`)

  // 補抓關卡：爬完若有失敗章節且未關閉，跑一輪 retry-failed（盡力而為，不卡 pipeline）
  const failed = await readFailedChapters(title)
  if (shouldRetryFailed(failed, o.retryFailed)) {
    console.log(`\n========== 🔁 補抓失敗章節（${failed.length} 章）==========\n`)
    await runScript(['retry-failed', title])
    const remaining = await readFailedChapters(title)
    console.log(`\n🔁 補抓完成，剩餘失敗 ${remaining.length} 章。\n`)
  }

  const bookDir = path.join(OUTPUT_ROOT, title)
  const mergedDir = path.join(OUTPUT_ROOT, title, 'merged')
  const mp4Dir = path.join(OUTPUT_ROOT, title, 'mp4')
  const coversDir = path.join(mp4Dir, '.covers')

  // ② TTS、③ 時長合併（複用既有腳本，失敗即停）
  const steps = [
    { label: '② TTS', args: buildAudiobookStep(title, o) },
    { label: '③ 時長合併', args: buildMergeStep(bookDir, mergedDir, o.target, o.tolerance) },
  ]
  for (const step of steps) {
    console.log(`\n========== ${step.label} ==========\n`)
    code = await runScript(step.args)
    if (code !== 0) return failAt(step.label, code)
  }

  // ④ 逐段封面 + MP4
  console.log('\n========== ④ 封面 + MP4 ==========\n')
  await mkdir(coversDir, { recursive: true })
  await ensureFfmpeg()

  const mergedAbs = mergedDir
  const mergedFiles = (await readdir(mergedAbs))
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .map((f) => path.join(mergedAbs, f))
  if (mergedFiles.length === 0) {
    console.error(`\n❌ ${mergedAbs} 內沒有合併後的 mp3，Pipeline 中止。`)
    process.exit(1)
  }

  const plans = buildPartMp4Plans(mergedFiles, coversDir, mp4Dir)
  const cover = new CoverGenerator()
  let failures = 0
  for (const plan of plans) {
    if (o.resume && (await Bun.file(plan.mp4Path).exists())) {
      console.log(`⏩ 跳過已存在: ${path.basename(plan.mp4Path)}`)
      continue
    }
    try {
      await cover.generateCover({
        title,
        partLabel: plan.partLabel,
        outPath: plan.coverPath,
        font: o.font,
      })
      const args = buildMP4WithImageCommand(
        plan.coverPath,
        plan.mp3Path,
        plan.mp4Path,
        o.bitrate,
        1920,
        1080,
        { title: `${title} ${plan.partLabel}`, album: title }
      )
      console.log(`🎬 ${plan.partLabel} → ${path.basename(plan.mp4Path)}`)
      const res = await $`ffmpeg ${args}`.nothrow()
      if (res.exitCode !== 0) {
        failures++
        console.error(`❌ ${plan.partLabel} ffmpeg exit ${res.exitCode}`)
      } else {
        console.log(`✅ ${path.basename(plan.mp4Path)}`)
      }
    } catch (e) {
      failures++
      console.error(`❌ ${plan.partLabel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (failures > 0) {
    console.error(`\n❌ ④ 有 ${failures} 段失敗。修正後重跑同指令即可接續。`)
    process.exit(1)
  }
  console.log(`\n✅ Pipeline 全部完成！MP4 位於 output/${title}/mp4/\n`)
}

function failAt(label: string, code: number): never {
  console.error(`\n❌ Pipeline 停在「${label}」(exit ${code})。`)
  console.error('修正後重跑同指令（加 --title=<書名> 可從爬取後接續）。')
  process.exit(1)
}

async function readFailedChapters(title: string): Promise<unknown[]> {
  try {
    const f = Bun.file(path.join(OUTPUT_ROOT, title, 'failed_chapters.json'))
    if (!(await f.exists())) return []
    const json = await f.json()
    return Array.isArray(json) ? json : []
  } catch {
    return []
  }
}

async function ensureFfmpeg(): Promise<void> {
  try {
    await $`ffmpeg -version`.quiet()
  } catch {
    console.error('❌ 找不到 ffmpeg，請先安裝（brew install ffmpeg）。')
    process.exit(1)
  }
}

main()
