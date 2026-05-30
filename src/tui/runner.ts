export interface AudiobookInput {
  title: string
  selection: string
  rate: string
  volume: string
  concurrency: string
  merge: boolean
}

export function buildAudiobookArgs(i: AudiobookInput): string[] {
  return ['audiobook', i.title, i.selection, i.rate, i.volume, i.concurrency, String(i.merge)]
}

export interface MergeInput {
  inputDir: string
  mode: 'count' | 'duration'
  value: string
}

export function buildMergeArgs(i: MergeInput): string[] {
  if (i.mode === 'duration') {
    return ['merge-mp3', i.inputDir, '--mode=duration', `--target=${i.value}`]
  }
  return ['merge-mp3', i.inputDir, `--size=${i.value}`]
}

export interface ConvertInput {
  inputDir: string
  outputDir: string
  metadata?: string
}

export function buildConvertArgs(i: ConvertInput): string[] {
  const args = ['to-mp4', `--input=${i.inputDir}`, `--output=${i.outputDir}`]
  if (i.metadata) args.push(`--metadata=${i.metadata}`)
  return args
}

export function buildCrawlArgs(url: string): string[] {
  return ['start', url]
}

export function buildBackupArgs(): string[] {
  return ['backup']
}

export function buildRetryArgs(title: string): string[] {
  return ['retry-failed', title]
}

/**
 * 以子程序執行 `bun run <args>`，stdio 直接繼承（即時串流）。
 * @param env 額外環境變數（例如 MP4_BITRATE）
 * @returns 子程序 exit code（0 = 成功）
 */
export async function runScript(args: string[], env?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', ...args], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  return await proc.exited
}
