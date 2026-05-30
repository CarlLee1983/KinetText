import { select, text, isCancel, cancel } from '@clack/prompts'
import * as fs from 'node:fs/promises'
import { scanAllBooks } from '../books'
import { buildConvertArgs, runScript } from '../runner'
import { OUTPUT_ROOT, mergedDir, m4aDir, metadataJsonPath } from '../paths'

export async function convertAction(presetTitle?: string): Promise<void> {
  let title = presetTitle
  if (!title) {
    const books = await scanAllBooks(OUTPUT_ROOT)
    if (books.length === 0) {
      console.log('\n（尚無書籍）\n')
      return
    }
    const picked = await select({ message: '選擇要轉檔的書籍', options: books.map((b) => ({ value: b.title, label: `${b.title}（merged ${b.merge.count} 檔）` })) })
    if (isCancel(picked)) return cancel('已取消')
    title = String(picked)
  }

  const bitrate = await text({ message: 'AAC bitrate（96k–320k）', initialValue: '256k' })
  if (isCancel(bitrate)) return cancel('已取消')

  let metadata: string | undefined
  try {
    await fs.access(metadataJsonPath(title))
    metadata = metadataJsonPath(title)
  } catch {
    metadata = undefined
  }

  const code = await runScript(
    buildConvertArgs({ inputDir: mergedDir(title), outputDir: m4aDir(title), metadata }),
    { MP4_BITRATE: String(bitrate) },
  )
  if (code !== 0) console.error(`\n❌ 轉檔失敗 (exit ${code})`)
}
