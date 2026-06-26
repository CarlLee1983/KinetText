import { $ } from 'bun'
import { buildCoverImageCommand } from '../utils/ffmpeg-commands'
import { getLogger } from '../utils/logger'

const logger = getLogger('CoverGenerator')

export interface CoverOptions {
  title: string
  partLabel: string
  outPath: string
  font: string
}

/**
 * 以 ffmpeg 生成靜態封面 jpg（純色底 + 書名 + partN）。
 */
export class CoverGenerator {
  async generateCover(opts: CoverOptions): Promise<string> {
    const fontFile = Bun.file(opts.font)
    if (!(await fontFile.exists())) {
      throw new Error(`字型檔不存在: ${opts.font}（可用 --font= 指定其他字型）`)
    }

    const args = buildCoverImageCommand({
      title: opts.title,
      partLabel: opts.partLabel,
      outPath: opts.outPath,
      font: opts.font,
    })

    logger.info({ out: opts.outPath, part: opts.partLabel }, '生成封面')
    const result = await $`ffmpeg ${args}`.quiet().nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`封面生成失敗 (ffmpeg exit ${result.exitCode}): ${result.stderr.toString().slice(-400)}`)
    }
    return opts.outPath
  }
}
