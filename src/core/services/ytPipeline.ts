export interface YtPipelineOptions {
  url: string
  target: string
  bitrate: number
  rate: string
  volume: string
  concurrency: string
  font: string
  resume: boolean
  dryRun: boolean
  title?: string
}

const DEFAULT_FONT = '/System/Library/Fonts/PingFang.ttc'

export function parseYtPipelineArgs(argv: string[]): YtPipelineOptions {
  const flags: Record<string, string | boolean> = {}
  let url = ''
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=')
      flags[k] = v ?? true
    } else if (!url) {
      url = arg
    }
  }
  if (!url) {
    throw new Error('缺少必要參數: <url>。用法: bun run yt-pipeline <url> [--target=6h ...]')
  }
  return {
    url,
    target: (flags.target as string) ?? '6h',
    bitrate: flags.bitrate ? parseInt(flags.bitrate as string, 10) : 256,
    rate: (flags.rate as string) ?? '+0%',
    volume: (flags.volume as string) ?? '+0%',
    concurrency: (flags.concurrency as string) ?? '3',
    font: (flags.font as string) ?? DEFAULT_FONT,
    resume: flags.resume === undefined ? true : flags.resume !== 'false',
    dryRun: flags['dry-run'] === true || flags['dry-run'] === 'true',
    title: flags.title as string | undefined,
  }
}

export function buildCrawlStep(url: string): string[] {
  return ['start', url]
}

export function buildAudiobookStep(title: string, o: YtPipelineOptions): string[] {
  return ['audiobook', title, 'all', o.rate, o.volume, o.concurrency, 'false']
}

export function buildMergeStep(bookDir: string, mergedDir: string, target: string): string[] {
  return ['merge-mp3', bookDir, '--mode=duration', `--target=${target}`, `--output=${mergedDir}`]
}

export type StepRunner = (args: string[]) => Promise<number>

export async function runStepsUntilFailure(
  steps: { label: string; args: string[] }[],
  run: StepRunner
): Promise<{ ok: boolean; failedLabel?: string }> {
  for (const step of steps) {
    const code = await run(step.args)
    if (code !== 0) {
      return { ok: false, failedLabel: step.label }
    }
  }
  return { ok: true }
}
