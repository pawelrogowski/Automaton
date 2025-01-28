import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.removeSync(path.join(__dirname, '../.electron-obfuscated'));
