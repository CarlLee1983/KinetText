/**
 * M4B 有聲書建構服務
 * 列章節 → 依時長分卷 → 逐卷 concat + 嵌章節 → ffmpeg 重編碼 AAC
 */

import { $ } from 'bun'
import path from 'node:path'
import { readdir, writeFile, unlink, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { DurationService } from './DurationService'
import { AudioMergeService } from './AudioMergeService'
import { RetryService } from './RetryService'
import { AudioErrorClassifier } from './AudioErrorClassifier'
import { buildM4BCommand } from '../utils/ffmpeg-commands'
import { buildFFMetadata, parseChapterTitle, type M4BChapterInput } from '../utils/m4b-metadata'
import { createLogger } from '../utils/logger'

/** 單一章節（已排序） */
export interface M4BChapter {
  readonly path: string
  readonly index: number
  readonly title: string
}

/** 注入式 shell executor（測試可攔截，不跑真 ffmpeg） */
export type M4BShellExecutor = (args: string[]) => Promise<void>

/** build() 選項 */
export interface M4BBuildOptions {
  readonly audioDir: string
  readonly outputDir: string
  readonly bookTitle: string
  readonly targetSeconds?: number
  readonly bitrate?: number
  readonly artist?: string
  readonly coverPath?: string
  readonly dryRun?: boolean
}

/** 單卷結果 */
export interface M4BVolumeResult {
  readonly volumeIndex: number
  readonly outputPath: string
  readonly chapterCount: number
  readonly estimatedDuration: number
  readonly error?: string
}

/** 整體報告 */
export interface M4BBuildReport {
  readonly bookTitle: string
  readonly audioDir: string
  readonly outputDir: string
  readonly totalChapters: number
  readonly totalVolumes: number
  readonly successCount: number
  readonly failureCount: number
  readonly volumes: ReadonlyArray<M4BVolumeResult>
  readonly dryRun: boolean
  readonly errors: ReadonlyArray<string>
}

export interface M4BBuilderServiceDeps {
  durationService?: DurationService
  mergeService?: AudioMergeService
  retryService?: RetryService
  shellExecutor?: M4BShellExecutor
}

const defaultShellExecutor: M4BShellExecutor = async (args) => {
  const result = await $`ffmpeg ${args}`.quiet()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().slice(0, 200)
    throw new Error(`FFmpeg M4B failed (exit ${result.exitCode}): ${stderr}`)
  }
}

export class M4BBuilderService {
  private readonly durationService: DurationService
  private readonly mergeService: AudioMergeService
  private readonly retryService: RetryService
  private readonly shellExecutor: M4BShellExecutor
  private readonly logger = createLogger('m4b-builder')

  constructor(deps: M4BBuilderServiceDeps = {}) {
    this.durationService = deps.durationService ?? new DurationService()
    this.mergeService = deps.mergeService ?? new AudioMergeService()
    this.retryService = deps.retryService ?? new RetryService(undefined, new AudioErrorClassifier())
    this.shellExecutor = deps.shellExecutor ?? defaultShellExecutor
  }

  /** 列出 audioDir 內的 .mp3 章節，依章節號排序 */
  async listChapters(audioDir: string): Promise<M4BChapter[]> {
    let entries: string[]
    try {
      entries = await readdir(audioDir)
    } catch {
      return []
    }
    const chapters: M4BChapter[] = []
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.mp3')) continue
      const m = name.match(/^(\d{1,5}) - /)
      const index = m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
      chapters.push({ path: path.join(audioDir, name), index, title: parseChapterTitle(name) })
    }
    return chapters.sort((a, b) => a.index - b.index)
  }

  /** 產生 ffmpeg concat list 內容（單引號跳脫，絕對路徑） */
  private buildConcatList(filePaths: ReadonlyArray<string>): string {
    return filePaths
      .map((fp) => `file '${path.resolve(fp).replace(/'/g, "'\\''")}'`)
      .join('\n')
  }

  /** 建單一卷：寫暫存 concat list + ffmetadata → 執行 ffmpeg → 驗證輸出 */
  private async buildVolume(
    chapters: ReadonlyArray<M4BChapter>,
    durations: ReadonlyMap<string, number>,
    outputPath: string,
    volumeTitle: string,
    book: { album: string; artist?: string },
    bitrate: number,
    coverPath?: string,
  ): Promise<void> {
    const safe = volumeTitle.replace(/[^\w]+/g, '_')
    const listPath = path.join(tmpdir(), `kineti_m4b_list_${process.pid}_${safe}.txt`)
    const metaPath = path.join(tmpdir(), `kineti_m4b_meta_${process.pid}_${safe}.txt`)
    try {
      const chapterInputs: M4BChapterInput[] = chapters.map((c) => ({
        title: c.title,
        durationSec: durations.get(c.path) ?? 0,
      }))
      await writeFile(listPath, this.buildConcatList(chapters.map((c) => c.path)), 'utf-8')
      await writeFile(
        metaPath,
        buildFFMetadata(chapterInputs, { album: book.album, artist: book.artist, title: volumeTitle }),
        'utf-8',
      )

      const args = buildM4BCommand(listPath, metaPath, outputPath, bitrate, coverPath)
      const r = await this.retryService.execute(
        () => this.shellExecutor(args),
        `m4b:${path.basename(outputPath)}`,
      )
      if (!r.success) throw r.error ?? new Error(`M4B build failed: ${outputPath}`)

      const info = await stat(outputPath)
      if (info.size === 0) throw new Error(`Output file is empty: ${outputPath}`)
    } finally {
      await unlink(listPath).catch(() => {})
      await unlink(metaPath).catch(() => {})
    }
  }

  /** 主流程：列章 → 讀時長 → 分卷 → 逐卷產 M4B → 報告 */
  async build(options: M4BBuildOptions): Promise<M4BBuildReport> {
    const targetSeconds = options.targetSeconds ?? 39600
    const bitrate = options.bitrate ?? 256
    const dryRun = options.dryRun ?? false
    const errors: string[] = []

    const chapters = await this.listChapters(options.audioDir)
    if (chapters.length === 0) {
      throw new Error(`audio/ 內找不到任何章節 mp3：${options.audioDir}`)
    }

    // 讀每章時長
    const durations = new Map<string, number>()
    for (const c of chapters) {
      durations.set(c.path, await this.durationService.getDuration(c.path))
    }

    // 分卷（沿用貪婪演算法）
    const groups = await this.mergeService.groupByDuration(
      chapters.map((c) => ({ path: c.path, duration: durations.get(c.path) ?? 0 })),
      targetSeconds,
    )

    // 將分卷結果對回 M4BChapter（依路徑）
    const byPath = new Map(chapters.map((c) => [c.path, c]))
    const volumeChapters = groups.map((g) => g.files.map((f) => byPath.get(f)!).filter(Boolean))

    if (dryRun) {
      const volumes: M4BVolumeResult[] = groups.map((g, i) => ({
        volumeIndex: i + 1,
        outputPath: path.join(options.outputDir, `${options.bookTitle}_vol${String(i + 1).padStart(2, '0')}.m4b`),
        chapterCount: g.files.length,
        estimatedDuration: g.estimatedDuration,
      }))
      return {
        bookTitle: options.bookTitle, audioDir: options.audioDir, outputDir: options.outputDir,
        totalChapters: chapters.length, totalVolumes: groups.length,
        successCount: 0, failureCount: 0, volumes, dryRun: true, errors: [],
      }
    }

    await mkdir(options.outputDir, { recursive: true })

    const volumes: M4BVolumeResult[] = []
    let successCount = 0
    let failureCount = 0
    for (let i = 0; i < volumeChapters.length; i++) {
      const chs = volumeChapters[i]
      const volNo = i + 1
      const outputPath = path.join(
        options.outputDir,
        `${options.bookTitle}_vol${String(volNo).padStart(2, '0')}.m4b`,
      )
      const volumeTitle = `${options.bookTitle} 第${volNo}卷`
      try {
        await this.buildVolume(
          chs, durations, outputPath, volumeTitle,
          { album: options.bookTitle, artist: options.artist ?? 'KinetiText TTS' },
          bitrate, options.coverPath,
        )
        volumes.push({ volumeIndex: volNo, outputPath, chapterCount: chs.length, estimatedDuration: groups[i].estimatedDuration })
        successCount++
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        this.logger.error({ volNo, error: msg }, '卷建構失敗')
        errors.push(`第${volNo}卷: ${msg}`)
        volumes.push({ volumeIndex: volNo, outputPath, chapterCount: chs.length, estimatedDuration: groups[i].estimatedDuration, error: msg })
        failureCount++
      }
    }

    return {
      bookTitle: options.bookTitle, audioDir: options.audioDir, outputDir: options.outputDir,
      totalChapters: chapters.length, totalVolumes: groups.length,
      successCount, failureCount, volumes, dryRun: false, errors,
    }
  }
}
