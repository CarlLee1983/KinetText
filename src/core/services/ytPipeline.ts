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
  crawlRetries?: number
  crawlConcurrency?: number
  crawlDelay?: number
  tolerance?: number
  retryFailed: boolean
}

const DEFAULT_FONT = '/System/Library/Fonts/PingFang.ttc'

export interface CrawlStepOptions {
  crawlRetries?: number
  crawlConcurrency?: number
  crawlDelay?: number
}

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
  const bitrate = flags.bitrate ? parseInt(flags.bitrate as string, 10) : 256
  if (isNaN(bitrate) || bitrate < 96 || bitrate > 320) {
    throw new Error(`無效的位元率: ${flags.bitrate}。bitrate 必須在 96–320 kbps 之間。`)
  }
  const parseOptInt = (v: unknown): number | undefined => {
    if (typeof v !== 'string') return undefined
    const n = parseInt(v, 10)
    return isNaN(n) ? undefined : n
  }

  const crawlRetries = parseOptInt(flags['crawl-retries'])
  const crawlConcurrency = parseOptInt(flags['crawl-concurrency'])
  const crawlDelay = parseOptInt(flags['crawl-delay'])

  // Validate crawl knob ranges
  if (crawlRetries !== undefined && crawlRetries < 1) {
    throw new Error('--crawl-retries 必須 >= 1')
  }
  if (crawlConcurrency !== undefined && crawlConcurrency < 1) {
    throw new Error('--crawl-concurrency 必須 >= 1')
  }
  if (crawlDelay !== undefined && crawlDelay < 0) {
    throw new Error('--crawl-delay 必須 >= 0')
  }

  return {
    url,
    target: (flags.target as string) ?? '6h',
    bitrate,
    rate: (flags.rate as string) ?? '+0%',
    volume: (flags.volume as string) ?? '+0%',
    concurrency: (flags.concurrency as string) ?? '3',
    font: (flags.font as string) ?? DEFAULT_FONT,
    resume: flags.resume === undefined ? true : flags.resume !== 'false',
    dryRun: flags['dry-run'] === true || flags['dry-run'] === 'true',
    title: flags.title as string | undefined,
    crawlRetries,
    crawlConcurrency,
    crawlDelay,
    tolerance: parseOptInt(flags['tolerance']),
    retryFailed: flags['no-retry-failed'] ? false : true,
  }
}

export function buildCrawlStep(url: string, opts?: CrawlStepOptions): string[] {
  const args = ['start', url]
  if (opts?.crawlRetries !== undefined) args.push(`--crawl-retries=${opts.crawlRetries}`)
  if (opts?.crawlConcurrency !== undefined) args.push(`--crawl-concurrency=${opts.crawlConcurrency}`)
  if (opts?.crawlDelay !== undefined) args.push(`--crawl-delay=${opts.crawlDelay}`)
  return args
}

export function buildAudiobookStep(title: string, o: YtPipelineOptions): string[] {
  return ['audiobook', title, 'all', o.rate, o.volume, o.concurrency, 'false']
}

export function buildMergeStep(
  bookDir: string,
  mergedDir: string,
  target: string,
  tolerance?: number
): string[] {
  const args = ['merge-mp3', bookDir, '--mode=duration', `--target=${target}`, `--output=${mergedDir}`]
  if (tolerance !== undefined) args.push(`--tolerance=${tolerance}`)
  return args
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

export function pickNewBook(before: string[], after: string[], titleOverride?: string): string {
  if (titleOverride) return titleOverride
  const beforeSet = new Set(before)
  const created = after.filter((b) => !beforeSet.has(b))
  if (created.length === 1) return created[0]!
  throw new Error(
    created.length === 0
      ? '爬取後找不到新書目錄，無法判定書名。請用 --title=<書名> 指定（重跑時常見）。'
      : `爬取後出現多個新目錄（${created.join(', ')}），請用 --title=<書名> 指定。`
  )
}

export interface PartMp4Plan {
  mp3Path: string
  coverPath: string
  mp4Path: string
  partLabel: string
}

export function buildPartMp4Plans(
  mergedMp3Files: string[],
  coversDir: string,
  mp4Dir: string
): PartMp4Plan[] {
  const sorted = [...mergedMp3Files].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
  return sorted.map((mp3Path, i) => {
    const partLabel = `part${i + 1}`
    const base = mp3Path.split('/').pop()!.replace(/\.mp3$/i, '')
    return {
      mp3Path,
      coverPath: `${coversDir}/${partLabel}.jpg`,
      mp4Path: `${mp4Dir}/${base}.mp4`,
      partLabel,
    }
  })
}

/**
 * 判定是否需要補抓失敗章節：啟用且失敗清單非空才補。
 */
export function shouldRetryFailed(failedList: unknown[], retryFailedEnabled: boolean): boolean {
  return retryFailedEnabled && Array.isArray(failedList) && failedList.length > 0
}
