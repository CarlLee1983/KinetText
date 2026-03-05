import { spawnSync } from 'child_process';
import { formatCliError, parseCommonCliFlags } from '../src/cli/common';

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
const { help, dryRun } = parseCommonCliFlags(process.argv.slice(2));

if (help) {
    console.log('Usage: bun run backup [--dry-run]');
    console.log('Options:');
    console.log('  --help, -h     Show help');
    console.log('  --dry-run      Print commands without executing rclone');
    process.exit(0);
}

async function runBackup() {
    console.log(`[Backup] Starting multi-point backup for ${SOURCE_DIR}...`);

    if (BACKUP_DESTINATIONS.length === 0) {
        console.warn('[Backup] No backup destinations defined. Please edit scripts/backup.ts');
        return;
    }

    for (const dest of BACKUP_DESTINATIONS) {
        console.log(`[Backup] >>> Syncing to: ${dest}`);
        if (dryRun) {
            console.log(`[Backup][Dry-run] rclone sync ${SOURCE_DIR} ${dest} --progress`);
            continue;
        }

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

runBackup().catch((error) => {
    console.error(`[Error] ${formatCliError(error)}`);
    process.exit(1);
});
