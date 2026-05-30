/**
 * M4B 有聲書 metadata 純函式
 * 章節標題解析 + FFMETADATA 文字產生（供 ffmpeg -i ffmetadata 使用）
 */

/** 單一章節輸入：標題與時長（秒） */
export interface M4BChapterInput {
  readonly title: string
  readonly durationSec: number
}

/** 卷層級書籍資訊 */
export interface M4BBookInfo {
  /** 專輯＝書名 */
  readonly album: string
  /** 作者 */
  readonly artist?: string
  /** 卷層級標題，如「某書 第1卷」 */
  readonly title?: string
}

/**
 * 由音檔檔名取出章節標題
 * 去除 "NNNN - " 前綴與副檔名；無前綴時回傳去副檔名的檔名
 */
export function parseChapterTitle(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, '')
  const stripped = noExt.replace(/^\d{1,5} - /, '')
  return stripped
}

/** FFMETADATA 規格：= ; # \ 與換行需以反斜線跳脫 */
function escapeFFMeta(value: string): string {
  return value.replace(/([=;#\\\n])/g, '\\$1')
}

/**
 * 產生 FFMETADATA1 文字：檔頭（album/artist/title）+ 每章 [CHAPTER] 區塊
 * 章節起訖由各章時長累計，TIMEBASE=1/1000（毫秒）
 */
export function buildFFMetadata(
  chapters: ReadonlyArray<M4BChapterInput>,
  book: M4BBookInfo,
): string {
  const lines: string[] = [';FFMETADATA1']
  lines.push(`album=${escapeFFMeta(book.album)}`)
  if (book.artist) lines.push(`artist=${escapeFFMeta(book.artist)}`)
  if (book.title) lines.push(`title=${escapeFFMeta(book.title)}`)

  let cursorMs = 0
  for (const ch of chapters) {
    const startMs = cursorMs
    const endMs = cursorMs + Math.round(ch.durationSec * 1000)
    lines.push('[CHAPTER]')
    lines.push('TIMEBASE=1/1000')
    lines.push(`START=${startMs}`)
    lines.push(`END=${endMs}`)
    lines.push(`title=${escapeFFMeta(ch.title)}`)
    cursorMs = endMs
  }

  return lines.join('\n') + '\n'
}
