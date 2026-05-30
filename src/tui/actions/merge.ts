import { select, text, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildMergeArgs, runScript } from '../runner'
import { OUTPUT_ROOT, bookDir } from '../paths'

export async function mergeAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({ message: '選擇要合併的書籍', options: books.map((b) => ({ value: b.title, label: b.title })) })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const mode = await select({
    message: '合併模式',
    options: [
      { value: 'duration', label: '按時長（適合上傳長度限制）' },
      { value: 'count', label: '按數量（每 N 章一檔）' },
    ],
  })
  if (isCancel(mode)) return cancel('已取消')

  let value: string
  if (mode === 'duration') {
    const t = await text({ message: '目標時長（秒，預設 11h=39600）', initialValue: '39600' })
    if (isCancel(t)) return cancel('已取消')
    value = String(t)
  } else {
    const s = await text({ message: '每檔章節數', initialValue: '100' })
    if (isCancel(s)) return cancel('已取消')
    value = String(s)
  }

  const code = await runScript(buildMergeArgs({ inputDir: bookDir(title), mode: mode as 'count' | 'duration', value }))
  if (code !== 0) console.error(`\n❌ 合併失敗 (exit ${code})`)
}
