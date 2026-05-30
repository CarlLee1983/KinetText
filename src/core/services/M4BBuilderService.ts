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
}
