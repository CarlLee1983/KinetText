import { select, isCancel, cancel } from '@clack/prompts'
import { formatSummary, getLastSummary, runDiagnostics } from '../diagnostics'

/**
 * 顯示最近一次診斷摘要，並可重新檢查。
 *
 * 摘要只是「上次看到的樣子」；真正啟動流程前會另行即時驗證，因此這裡不必
 * 保證它是最新的，只需標明它有多舊。
 */
export async function diagnosticsAction(): Promise<void> {
  console.log(`\n${formatSummary(getLastSummary())}\n`)

  const next = await select({
    message: '診斷',
    options: [
      { value: 'recheck', label: '🔄 重新檢查' },
      { value: 'back', label: '↩  返回' },
    ],
  })

  if (isCancel(next) || next === 'back') {
    cancel('已返回')
    return
  }

  console.log('\n檢查中…')
  const summary = await runDiagnostics()
  console.log(`\n${formatSummary(summary)}\n`)
}
