import { spawnSync } from 'child_process';

/**
 * 定義備份目標點位 (Rclone Remote Names)
 * 請確保您已透過 `rclone config` 設定好這些名稱
 */
const BACKUP_DESTINATIONS = [
    'novel-backup-gdrive:kinetitext-backup',  // Google Drive 範例
    'novel-backup-s3:my-novel-bucket',        // S3/R2 範例
    // 'novel-backup-onedrive:novels',        // 可持續增加點位
];

const SOURCE_DIR = './output';

async function runBackup() {
    console.log(`[Backup] Starting multi-point backup for ${SOURCE_DIR}...`);

    if (BACKUP_DESTINATIONS.length === 0) {
        console.warn('[Backup] No backup destinations defined. Please edit scripts/backup.ts');
        return;
    }

    for (const dest of BACKUP_DESTINATIONS) {
        console.log(`[Backup] >>> Syncing to: ${dest}`);

        const result = spawnSync('rclone', ['sync', SOURCE_DIR, dest, '--progress'], {
            stdio: 'inherit',
            shell: true
        });

        if (result.status === 0) {
            console.log(`[Backup] Success: ${dest}`);
        } else {
            console.error(`[Backup] Failed: ${dest} (Exit Code: ${result.status})`);
        }
    }

    console.log('[Backup] All backup tasks completed.');
}

runBackup().catch(console.error);
