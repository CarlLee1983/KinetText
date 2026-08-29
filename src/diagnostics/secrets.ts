import { createHmac, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/*
 * 此處使用 node:crypto 而非 Bun.CryptoHasher：需要的是 keyed hash（HMAC），
 * Bun 內建的雜湊 API 不提供帶金鑰的形式。
 */

/** 未設定的祕密所對應的固定表示，與任何已設定值的指紋都不相同。 */
const UNSET = 'unset'

const KEY_ENV = 'KINETITEXT_FINGERPRINT_KEY'
const KEY_PATH = resolve(import.meta.dir, '../../.kinetitext/fingerprint.key')

let cachedKey: string | undefined

/**
 * 取得本機安裝專屬的指紋金鑰。
 *
 * 優先讀環境變數，其次讀本機金鑰檔，皆無則產生並寫入。金鑰不進版控，
 * 因此同一份祕密在不同機器上的指紋不同——這正是要的：指紋只用於在
 * 同一份安裝內判斷相關設定是否變更。
 */
function installKey(): string {
  if (cachedKey) return cachedKey

  const fromEnv = process.env[KEY_ENV]
  if (fromEnv) {
    cachedKey = fromEnv
    return cachedKey
  }

  try {
    const stored = readFileSync(KEY_PATH, 'utf-8').trim()
    if (stored) {
      cachedKey = stored
      return cachedKey
    }
  } catch {
    // 金鑰檔尚未建立，往下產生
  }

  const generated = randomBytes(32).toString('hex')
  try {
    mkdirSync(dirname(KEY_PATH), { recursive: true })
    writeFileSync(KEY_PATH, generated, { mode: 0o600 })
  } catch {
    // 唯讀的 checkout 或容器裡寫不進去。指紋在該次執行內仍然一致，只是不跨執行
    // 穩定——這比讓一個「檢查流程能否進行」的步驟自己因檔案系統錯誤而死要好。
  }
  cachedKey = generated
  return cachedKey
}

/**
 * 產生祕密設定指紋。
 *
 * 依 ADR-0001：不保存原始祕密值，僅保留不可逆識別以判斷相關設定是否變更。
 * 依 ADR-0003：使用本機安裝專屬金鑰的 HMAC，並以設定名稱做域分離——低熵
 * 祕密（遠端名稱、短權杖）的無鹽雜湊可被字典還原，而這份輸出的設計用途
 * 正是可以安全地交給他人閱讀。
 *
 * 未設定與設為空字串是不同的狀態，因此指紋亦不同。
 */
export function secretFingerprint(value: string | undefined, name = ''): string {
  if (value === undefined) return UNSET
  return createHmac('sha256', installKey())
    .update(`${name} ${value}`)
    .digest('hex')
    .slice(0, 16)
}
