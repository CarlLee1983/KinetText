import { text, confirm, isCancel, cancel } from '@clack/prompts'
import {
  buildCrawlArgs,
  buildAudiobookArgs,
  buildMergeArgs,
  buildConvertArgs,
  buildBackupArgs,
  runScript,
} from '../runner'

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

  const title = await text({ message: '書名（須與爬取後的資料夾名一致）' })
  if (isCancel(title)) return cancel('已取消')

  const go = await confirm({ message: `將依序執行：爬取 → TTS(all) → 合併 → 轉檔 → 備份。開始？`, initialValue: true })
  if (isCancel(go) || !go) return cancel('已取消')

  const t = String(title)
  const steps: Step[] = [
    { label: '① 爬取', args: buildCrawlArgs(String(url)) },
    { label: '② TTS', args: buildAudiobookArgs({ title: t, selection: 'all', rate: '+0%', volume: '+0%', concurrency: '3', merge: false }) },
    { label: '③ 合併', args: buildMergeArgs({ inputDir: `output/${t}`, mode: 'duration', value: '39600' }) },
    { label: '④ 轉檔', args: buildConvertArgs({ inputDir: `output/${t}/merged`, outputDir: `output/${t}/m4a` }) },
    { label: '⑤ 備份', args: buildBackupArgs() },
  ]

  for (const step of steps) {
    console.log(`\n========== ${step.label} ==========\n`)
    const code = await runScript(step.args, step.env)
    if (code !== 0) {
      console.error(`\n❌ Pipeline 停在「${step.label}」(exit ${code})。`)
      console.error(`修正後可重開 bun run menu 從該步手動接續。`)
      return
    }
  }
  console.log('\n✅ Pipeline 全部完成！\n')
}
