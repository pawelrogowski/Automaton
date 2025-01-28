import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import javascriptObfuscator from 'javascript-obfuscator';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const config = {
  obfuscation: {
    compact: true,
    controlFlowFlattening: true,
    identifierNamesGenerator: 'hexadecimal',
  },
  pathObfuscation: {
    hashLength: 8,
    ignoreFiles: ['package.json'],
    ignoreExtensions: ['.node', '.json'],
  },
};

class PathObfuscator {
  constructor() {
    this.pathMap = new Map();
    this.reverseMap = new Map();
  }

  generateHash(originalPath) {
    return crypto.createHash('sha256').update(originalPath).digest('hex').substring(0, config.pathObfuscation.hashLength);
  }

  async processDirectory(src, dest) {
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const originalPath = path.join(src, entry.name);
      const relativePath = path.relative(src, originalPath);

      // Generate obfuscated name
      const hash = this.generateHash(relativePath);
      const obfuscatedName = entry.isDirectory() ? `d_${hash}` : `f_${hash}${path.extname(entry.name)}`;

      this.pathMap.set(relativePath, obfuscatedName);
      this.reverseMap.set(obfuscatedName, relativePath);

      const newPath = path.join(dest, obfuscatedName);

      if (entry.isDirectory()) {
        await fs.ensureDir(newPath);
        await this.processDirectory(originalPath, newPath);
      } else {
        await this.processFile(originalPath, newPath);
      }
    }
  }

  async processFile(srcPath, destPath) {
    const ext = path.extname(srcPath);

    if (config.pathObfuscation.ignoreExtensions.includes(ext)) {
      await fs.copy(srcPath, destPath);
      return;
    }

    let content = await fs.readFile(srcPath, 'utf8');

    // Update path references
    this.reverseMap.forEach((original, obfuscated) => {
      const regex = new RegExp(`(['"])(${original.replace(/[/]/g, '[/]')})(['"])`, 'g');
      content = content.replace(regex, `$1${obfuscated}$3`);
    });

    // Obfuscate code
    if (ext === '.js') {
      content = javascriptObfuscator.obfuscate(content, config.obfuscation).getObfuscatedCode();
    }

    await fs.writeFile(destPath, content);
  }
}

async function build() {
  const srcDir = path.join(__dirname, '../electron');
  const destDir = path.join(__dirname, '../.electron-obfuscated');

  // Clean previous build
  await fs.remove(destDir);
  await fs.ensureDir(destDir);

  // Process files
  const obfuscator = new PathObfuscator();
  await obfuscator.processDirectory(srcDir, destDir);

  // Save mapping for debugging (exclude from production)
  await fs.writeJson(path.join(destDir, 'path-map.json'), Object.fromEntries(obfuscator.pathMap));

  console.log('✅ Full obfuscation completed!');
  console.log(`📁 Original structure mapped to ${obfuscator.pathMap.size} obfuscated paths`);
}

build().catch((err) => {
  console.error('🚨 Build failed:', err);
  process.exit(1);
});
