import { select, text, isCancel, cancel } from '@clack/prompts'
import { scanAllBooks } from '../books'
import { buildM4bArgs, runScript } from '../runner'
import { guardLaunch } from '../diagnostics'
import { OUTPUT_ROOT } from '../paths'

export async function m4bAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({
      message: '選擇要生成 M4B 的書籍',
      options: books.map((b) => ({ value: b.title, label: `${b.title}（TTS ${b.tts.done} 章）` })),
    })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const bitrate = await text({ message: 'AAC bitrate（96–320）', initialValue: '256' })
  if (isCancel(bitrate)) return cancel('已取消')

  const hours = await text({ message: '每卷目標時長（小時）', initialValue: '11' })
  if (isCancel(hours)) return cancel('已取消')
  const target = String(Math.round(parseFloat(String(hours)) * 3600))

  if (!(await guardLaunch('m4b'))) return

  const code = await runScript(buildM4bArgs({ title, target, bitrate: String(bitrate) }))
  if (code !== 0) console.error(`\n❌ M4B 生成失敗 (exit ${code})`)
}
