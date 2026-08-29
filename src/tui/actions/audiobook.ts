import { select, text, confirm, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildAudiobookArgs, runScript } from '../runner'
import { guardLaunch } from '../diagnostics'
import { OUTPUT_ROOT } from '../paths'

async function pickBook(message: string): Promise<string | null> {
  const books = await scanAllBooks(OUTPUT_ROOT)
  if (books.length === 0) {
    console.log('\n（尚無書籍，請先爬取）\n')
    return null
  }
  const title = await select({
    message,
    options: books.map((b) => ({ value: b.title, label: `${b.title}（txt ${b.crawl.saved} 章 / 缺 ${b.tts.missing.length}）` })),
  })
  if (isCancel(title)) {
    cancel('已取消')
    return null
  }
  return String(title)
}

export async function audiobookAction(presetTitle?: string): Promise<void> {
  const sourceMode = await select({
    message: '章節來源',
    options: [
      { value: 'output', label: 'output/ 已爬取書籍' },
      { value: 'local', label: '本地目錄（.txt / .md）' },
    ],
  })
  if (isCancel(sourceMode)) return cancel('已取消')

  let title: string | undefined
  let inputDir: string | undefined
  let outputDir: string | undefined

  if (sourceMode === 'local') {
    const input = await text({
      message: '章節目錄路徑',
      placeholder: '/Users/carl/Dev/Fiction/Read-World/chapters',
    })
    if (isCancel(input)) return cancel('已取消')
    inputDir = String(input).trim()

    const output = await text({
      message: 'MP3 輸出目錄（留空 → 同層 audio/）',
      placeholder: '',
    })
    if (isCancel(output)) return cancel('已取消')
    const trimmed = String(output).trim()
    if (trimmed) outputDir = trimmed
  } else {
    const picked = presetTitle ?? (await pickBook('選擇要生成語音的書籍'))
    if (!picked) return
    title = picked
  }

  const selection = await text({ message: '章節範圍', placeholder: '5 / 10-20 / 2,4,10', initialValue: 'all' })
  if (isCancel(selection)) return cancel('已取消')
  const rate = await text({ message: '語速（如 +20% / -10%）', initialValue: '+0%' })
  if (isCancel(rate)) return cancel('已取消')
  const volume = await text({ message: '音量（如 +50%）', initialValue: '+0%' })
  if (isCancel(volume)) return cancel('已取消')
  const concurrency = await text({ message: '並行數', initialValue: '3' })
  if (isCancel(concurrency)) return cancel('已取消')
  const merge = await confirm({ message: '跑完後合併？', initialValue: false })
  if (isCancel(merge)) return cancel('已取消')

  if (!(await guardLaunch('audiobook'))) return

  const code = await runScript(
    buildAudiobookArgs({
      title,
      inputDir,
      outputDir,
      selection: String(selection),
      rate: String(rate),
      volume: String(volume),
      concurrency: String(concurrency),
      merge: Boolean(merge),
    }),
  )
  if (code !== 0) console.error(`\n❌ TTS 失敗 (exit ${code})`)
}
