import { select, isCancel } from '@clack/prompts'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFile } from 'music-metadata'
import { scanAllBooks, type BookStatus, type Overall } from './books'
import { OUTPUT_ROOT, mergedDir } from './paths'
import { audiobookAction } from './actions/audiobook'
import { mergeAction } from './actions/merge'
import { convertAction } from './actions/convert'
import { runScript, buildRetryArgs } from './runner'

export function formatStageCell(done: number, total: number): string {
  if (total === 0 && done === 0) return '—'
  if (done >= total && total > 0) return `${done}/${total} ✓`
  return `${done}/${total}`
}

export function overallLabel(o: Overall): string {
  switch (o) {
    case 'complete': return '✅ 完成'
    case 'merge': return '🔗 待轉檔'
    case 'tts': return '🔄 TTS 中'
    case 'crawl': return '🕷 已爬取'
    case 'created': return '⏸ 僅建立'
  }
}

/** 估算 merged 目錄總時長（秒）；失敗回 null（best-effort） */
async function mergedDurationSec(title: string): Promise<number | null> {
  try {
    const dir = mergedDir(title)
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.mp3'))
    let total = 0
    for (const f of files) {
      const meta = await parseFile(path.join(dir, f))
      total += meta.format.duration ?? 0
    }
    return total
  } catch {
    return null
  }
}

function renderOverview(books: BookStatus[]): void {
  console.log('')
  console.log('書名'.padEnd(20) + '爬取'.padEnd(14) + 'TTS'.padEnd(14) + '合併'.padEnd(8) + '轉檔'.padEnd(8) + '狀態')
  console.log('─'.repeat(72))
  for (const b of books) {
    const crawl = formatStageCell(b.crawl.saved, b.crawl.total ?? 0) + (b.crawl.failed > 0 ? ' ⚠' : '')
    const tts = formatStageCell(b.tts.done, b.tts.total)
    const merge = b.merge.count > 0 ? `${b.merge.count} 檔` : '—'
    const conv = b.convert.m4a + b.convert.mp4 + b.m4b.count > 0
      ? `${b.convert.m4a + b.convert.mp4 + b.m4b.count} ✓` : '—'
    console.log(
      b.title.padEnd(18) + crawl.padEnd(14) + tts.padEnd(14) + merge.padEnd(8) + conv.padEnd(8) + overallLabel(b.overall),
    )
  }
  console.log('')
}

async function renderExpanded(b: BookStatus): Promise<void> {
  const dur = await mergedDurationSec(b.title)
  const durStr = dur ? ` 總時長 ~${(dur / 3600).toFixed(1)}h` : ''
  console.log('')
  console.log(`📖 ${b.title}`)
  console.log(`├ 爬取    ${b.crawl.saved}/${b.crawl.total ?? '—'} 章   失敗 ${b.crawl.failed}   (${b.crawl.reportDate ?? '無報告'})`)
  console.log(`├ TTS     ${b.tts.done} 個 mp3   缺 ${b.tts.missing.length} 章` +
    (b.tts.missing.length > 0 ? `：${b.tts.missing.slice(0, 20).join(', ')}${b.tts.missing.length > 20 ? ' …' : ''}` : ''))
  console.log(`├ 合併    ${b.merge.count} 個 merged 檔${durStr}`)
  console.log(`├ 轉檔    ${b.convert.m4a} 個 m4a / ${b.convert.mp4} 個 mp4`)
  console.log(`├ M4B     ${b.m4b.count} 卷`)
  console.log(`├ 元資料  ${b.metadata ? '✓' : '✗'}`)
  const failHead = b.failedChapters.length > 0
    ? b.failedChapters.slice(0, 10).map((c) => `${c.index}(${c.reason ?? '?'})`).join(', ')
    : '無'
  console.log(`└ ⚠ 失敗章節 (${b.failedChapters.length})：${failHead}`)
  console.log('')
}

/** 主入口：總覽 → 選書展開 → 子操作 */
export async function showStatus(): Promise<void> {
  const books = await scanAllBooks(OUTPUT_ROOT)
  if (books.length === 0) {
    console.log('\n（output/ 下尚無任何書籍）\n')
    return
  }
  renderOverview(books)

  const pick = await select({
    message: '展開哪一本？',
    options: [...books.map((b) => ({ value: b.title, label: b.title })), { value: '__back', label: '← 返回主選單' }],
  })
  if (isCancel(pick) || pick === '__back') return

  const book = books.find((b) => b.title === pick)!
  await renderExpanded(book)

  const op = await select({
    message: '操作',
    options: [
      { value: 'tts', label: '接續跑 TTS（補缺章）' },
      { value: 'retry', label: '重試失敗章節' },
      { value: 'merge', label: '合併' },
      { value: 'convert', label: '轉檔' },
      { value: 'back', label: '← 返回' },
    ],
  })
  if (isCancel(op) || op === 'back') return

  switch (op) {
    case 'tts': await audiobookAction(book.title); break
    case 'retry': {
      const code = await runScript(buildRetryArgs(book.title))
      if (code !== 0) console.error(`\n❌ 重試失敗 (exit ${code})`)
      break
    }
    case 'merge': await mergeAction(book.title); break
    case 'convert': await convertAction(book.title); break
  }
}
