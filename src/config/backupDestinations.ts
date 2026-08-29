/**
 * 備份目標點位（rclone remote 名稱）。
 *
 * 每一項的形式是 `<遠端名稱>:<路徑>`。遠端名稱需先以 `rclone config` 設定；
 * 診斷只確認其存在與可辨識性，不提前驗證連線或權限。
 */
export const BACKUP_DESTINATIONS: readonly string[] = [
  'novel-backup-gdrive:kinetitext-backup', // Google Drive 範例
  'novel-backup-s3:my-novel-bucket', // S3/R2 範例
  // 'novel-backup-onedrive:novels',       // 可持續增加點位
]

/**
 * 出廠隨附的範例點位。
 *
 * 這些名稱不是真實設定，只是讓使用者知道格式。診斷據此分辨「尚未設定備份目標」
 * 與「設定了但遠端不存在」——前者不該讓診斷以阻斷收場，否則任何還沒用到備份的
 * 使用者都會拿到一個恆為失敗的結束碼。
 */
const EXAMPLE_DESTINATIONS: readonly string[] = [
  'novel-backup-gdrive:kinetitext-backup',
  'novel-backup-s3:my-novel-bucket',
]

/** 目標清單是否仍是未經修改的出廠範例。 */
export function isExampleDestinations(
  destinations: readonly string[] = BACKUP_DESTINATIONS
): boolean {
  return (
    destinations.length > 0 &&
    destinations.every((destination) => EXAMPLE_DESTINATIONS.includes(destination))
  )
}

/**
 * 從目標點位取出遠端名稱（冒號之前的部分）。
 *
 * 不含冒號的項目不是合法的 rclone 目標（多半是誤填的本機路徑），在此就擋下來，
 * 而不是讓診斷去查一個不存在的遠端名稱。
 */
export function backupRemoteNames(
  destinations: readonly string[] = BACKUP_DESTINATIONS
): readonly string[] {
  const names = destinations.map((destination) => {
    const [name, ...rest] = destination.split(':')
    if (!name || rest.length === 0) {
      throw new Error(
        `備份目標點位格式錯誤：${destination}（應為 <遠端名稱>:<路徑>）`
      )
    }
    return name
  })
  return [...new Set(names)]
}
