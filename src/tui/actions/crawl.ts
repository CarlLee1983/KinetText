import { text, isCancel, cancel } from '@clack/prompts'
import { buildCrawlArgs, runScript } from '../runner'
import { guardLaunch } from '../diagnostics'

export async function crawlAction(): Promise<void> {
  const url = await text({
    message: '小說網址 URL',
    placeholder: 'https://twp.zhys.tw/book/777167.html',
    validate: (v) => (v && v.startsWith('http') ? undefined : '請輸入有效的 http(s) 網址'),
  })
  if (isCancel(url)) {
    cancel('已取消')
    return
  }
  if (!(await guardLaunch('crawl', { url: String(url) }))) return

  const code = await runScript(buildCrawlArgs(String(url)))
  if (code !== 0) console.error(`\n❌ 爬取失敗 (exit ${code})`)
}
