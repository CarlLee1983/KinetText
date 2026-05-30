import path from 'node:path'

/** output/ 根目錄（執行時相對於專案根） */
export const OUTPUT_ROOT = path.join(process.cwd(), 'output')

export const bookDir = (title: string): string => path.join(OUTPUT_ROOT, title)
export const txtDir = (title: string): string => path.join(bookDir(title), 'txt')
export const audioDir = (title: string): string => path.join(bookDir(title), 'audio')
export const mergedDir = (title: string): string => path.join(bookDir(title), 'merged')
export const m4aDir = (title: string): string => path.join(bookDir(title), 'm4a')
export const m4bDir = (title: string): string => path.join(bookDir(title), 'm4b')
export const metadataJsonPath = (title: string): string => path.join(bookDir(title), 'metadata.json')
