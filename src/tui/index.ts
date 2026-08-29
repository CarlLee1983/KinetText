import { intro, outro, select, isCancel } from '@clack/prompts'
import { showStatus } from './status'
import { crawlAction } from './actions/crawl'
import { audiobookAction } from './actions/audiobook'
import { mergeAction } from './actions/merge'
import { convertAction } from './actions/convert'
import { m4bAction } from './actions/m4b'
import { backupAction } from './actions/backup'
import { pipelineAction } from './actions/pipeline'
import { diagnosticsAction } from './actions/diagnostics'

async function main(): Promise<void> {
  intro('📚 KinetiText 控制台')

  while (true) {
    const action = await select({
      message: '選擇動作',
      options: [
        { value: 'status', label: '📊 檢視狀態' },
        { value: 'diagnostics', label: '🩺 診斷本機能力' },
        { value: 'crawl', label: '🕷  爬取小說' },
        { value: 'audiobook', label: '🎙  生成語音書 (TTS)' },
        { value: 'merge', label: '🔗 合併 MP3' },
        { value: 'convert', label: '🎬 轉檔 M4A' },
        { value: 'm4b', label: '🎧 生成 M4B 有聲書' },
        { value: 'backup', label: '☁  雲端備份' },
        { value: 'pipeline', label: '🚀 一鍵全跑' },
        { value: 'exit', label: '🚪 離開' },
      ],
    })

    if (isCancel(action) || action === 'exit') {
      outro('掰掰 👋')
      break
    }

    try {
      switch (action) {
        case 'status': await showStatus(); break
        case 'diagnostics': await diagnosticsAction(); break
        case 'crawl': await crawlAction(); break
        case 'audiobook': await audiobookAction(); break
        case 'merge': await mergeAction(); break
        case 'convert': await convertAction(); break
        case 'm4b': await m4bAction(); break
        case 'backup': await backupAction(); break
        case 'pipeline': await pipelineAction(); break
      }
    } catch (e) {
      console.error(`\n❌ 發生錯誤：${e instanceof Error ? e.message : String(e)}\n`)
    }
  }
}

main()
