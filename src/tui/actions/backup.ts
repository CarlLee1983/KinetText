import { confirm, isCancel, cancel } from '@clack/prompts'
import { buildBackupArgs, runScript } from '../runner'
import { guardLaunch } from '../diagnostics'

export async function backupAction(): Promise<void> {
  const ok = await confirm({ message: '開始雲端備份？', initialValue: true })
  if (isCancel(ok) || !ok) {
    cancel('已取消')
    return
  }
  if (!(await guardLaunch('backup'))) return

  const code = await runScript(buildBackupArgs())
  if (code !== 0) console.error(`\n❌ 備份失敗 (exit ${code})`)
}
