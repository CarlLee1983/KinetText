import { text, select, confirm, isCancel, cancel } from '@clack/prompts'
import * as fs from 'node:fs/promises'
import { scanAllBooks } from '../books'
import {
  buildCrawlArgs,
  buildAudiobookArgs,
  buildMergeArgs,
  buildConvertArgs,
  buildBackupArgs,
  runScript,
} from '../runner'
import { OUTPUT_ROOT, bookDir, mergedDir, m4aDir, metadataJsonPath } from '../paths'

interface Step {
  label: string
  args: string[]
  env?: Record<string, string>
}

export async function pipelineAction(): Promise<void> {
  const url = await text({
    message: '小說網址 URL（會從爬取一路跑到備份）',
    placeholder: 'https://twp.zhys.tw/book/777167.html',
    validate: (v) => (v && v.startsWith('http') ? undefined : '請輸入有效的 http(s) 網址'),
  })
  if (isCancel(url)) return cancel('已取消')

  const go = await confirm({ message: '將依序執行：爬取 → TTS(all) → 合併 → 轉檔 → 備份。開始？', initialValue: true })
  if (isCancel(go) || !go) return cancel('已取消')

  // 步驟 1：爬取
  console.log('\n========== ① 爬取 ==========\n')
  let code = await runScript(buildCrawlArgs(String(url)))
  if (code !== 0) {
    console.error(`\n❌ Pipeline 停在「① 爬取」(exit ${code})。`)
    return
  }

  // 爬取後重新掃描，讓使用者選剛產生的書（資料夾名可能被 sanitize 過，不靠手打書名）
  const books = await scanAllBooks(OUTPUT_ROOT)
  if (books.length === 0) {
    console.error('\n❌ 爬取後在 output/ 找不到任何書籍，Pipeline 中止。')
    return
  }
  const picked = await select({
    message: '剛爬好的是哪一本？（接下來對它做 TTS→合併→轉檔）',
    options: books.map((b) => ({ value: b.title, label: `${b.title}（txt ${b.crawl.saved} 章）` })),
  })
  if (isCancel(picked)) return cancel('已取消')
  const t = String(picked)

  let metadata: string | undefined
  try {
    await fs.access(metadataJsonPath(t))
    metadata = metadataJsonPath(t)
  } catch {
    metadata = undefined
  }

  const steps: Step[] = [
    { label: '② TTS', args: buildAudiobookArgs({ title: t, selection: 'all', rate: '+0%', volume: '+0%', concurrency: '3', merge: false }) },
    { label: '③ 合併', args: buildMergeArgs({ inputDir: bookDir(t), mode: 'duration', value: '39600' }) },
    { label: '④ 轉檔', args: buildConvertArgs({ inputDir: mergedDir(t), outputDir: m4aDir(t), metadata }) },
    { label: '⑤ 備份', args: buildBackupArgs() },
  ]

  for (const step of steps) {
    console.log(`\n========== ${step.label} ==========\n`)
    code = await runScript(step.args, step.env)
    if (code !== 0) {
      console.error(`\n❌ Pipeline 停在「${step.label}」(exit ${code})。`)
      console.error('修正後可重開 bun run menu 從該步手動接續。')
      return
    }
  }
  console.log('\n✅ Pipeline 全部完成！\n')
}
