import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TIBIA_MINIMAP_BASE_PATH = path.join(
  os.homedir(),
  '.local',
  'share',
  'CipSoft GmbH',
  'Tibia',
  'packages',
  'Tibia',
  'minimap',
);
const BACKUP_DIR = path.join(TIBIA_MINIMAP_BASE_PATH, 'minimap_backup');

async function restoreMinimaps() {
  console.log('--- Restoring original minimap files from backup ---');
  try {
    await fs.access(BACKUP_DIR);
    const backupFiles = await fs.readdir(BACKUP_DIR);
    if (backupFiles.length === 0) {
      console.log('Backup directory is empty. No files to restore.');
      return;
    }

    let restoredCount = 0;
    for (const file of backupFiles) {
      const backupPath = path.join(BACKUP_DIR, file);
      const originalPath = path.join(TIBIA_MINIMAP_BASE_PATH, file);
      await fs.copyFile(backupPath, originalPath);
      restoredCount++;
    }
    console.log(`Successfully restored ${restoredCount} files.`);
    console.log('You can now safely re-run the preprocessing script.');

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Backup directory not found. It seems no backups were made.');
    } else {
      console.error('An error occurred during restoration:', error);
    }
  }
}

restoreMinimaps();
