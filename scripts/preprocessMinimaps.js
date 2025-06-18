// This script pre-processes Tibia's minimap PNG files into a highly optimized custom binary format.
// It reads a pre-generated `palette.json` file which contains all unique colors found on the minimap.
// For each pixel in a PNG tile, it finds the color's corresponding index (0-14) in the palette.
// Since there are fewer than 16 colors, each index only needs 4 bits of storage. The script "packs"
// the 4-bit indices of two adjacent pixels into a single 8-bit byte, drastically reducing file size.
// The final output is a set of `.bin` files (one per tile) with a small header, the packed pixel data,
// and a single `index.json` file to map coordinates to these new, highly efficient files.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

const logger = createLogger({ info: true, error: true, debug: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PREPROCESSED_OUTPUT_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
const PALETTE_PATH = path.join(PREPROCESSED_OUTPUT_DIR, 'palette.json');
const TARGET_Z_LEVEL = 7; // Focusing on ground floor for now

async function preprocessMinimaps() {
  logger('info', '--- Starting Minimap Pre-processing ---');

  // Load the color palette and create a fast lookup map from color to index
  logger('info', `Loading palette from ${PALETTE_PATH}...`);
  const palette = JSON.parse(await fs.readFile(PALETTE_PATH, 'utf-8'));
  const colorToIndexMap = new Map();
  palette.forEach((color, index) => {
    colorToIndexMap.set(`${color.r},${color.g},${color.b}`, index);
  });
  logger('info', `Palette loaded with ${palette.length} colors. Using 4-bit indexed format.`);

  // Setup paths and data structures
  logger('info', `Processing minimaps for Z-level ${TARGET_Z_LEVEL}...`);
  logger('info', `Reading from: ${TIBIA_MINIMAP_BASE_PATH}`);
  logger('info', `Writing to: ${PREPROCESSED_OUTPUT_DIR}`);

  const zLevelOutputDir = path.join(PREPROCESSED_OUTPUT_DIR, `z${TARGET_Z_LEVEL}`);
  await fs.mkdir(zLevelOutputDir, { recursive: true });

  const indexFilePath = path.join(zLevelOutputDir, 'index.json');
  const indexData = {
    z: TARGET_Z_LEVEL,
    tiles: [],
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  try {
    const files = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
    const minimapPngFiles = files.filter((file) => file.startsWith('Minimap_Color_') && file.endsWith('.png'));

    for (const file of minimapPngFiles) {
      const parts = file.match(/Minimap_Color_(\d+)_(\d+)_(\d+)\.png/);
      if (!parts) {
        logger('warn', `Skipping malformed file name: ${file}`);
        continue;
      }

      const x = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      const z = parseInt(parts[3], 10);

      if (z !== TARGET_Z_LEVEL) {
        continue; // Silently skip non-target Z-levels
      }

      const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, file);
      const outputFileName = `Minimap_Color_${x}_${y}.bin`;
      const outputFilePath = path.join(zLevelOutputDir, outputFileName);

      try {
        const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });

        if (info.channels !== 3) {
          logger('warn', `Skipping ${file}: Expected 3 channels (RGB), got ${info.channels}.`);
          continue;
        }

        // --- 4-bit Indexed Color Packing Logic ---
        const pixelCount = info.width * info.height;
        const packedData = Buffer.alloc(Math.ceil(pixelCount / 2));
        let packedDataIndex = 0;

        // Process two pixels (6 bytes of RGB data) in each iteration
        for (let i = 0; i < pixelCount * 3; i += 6) {
          // Get the palette index for the first pixel
          const r1 = data[i],
            g1 = data[i + 1],
            b1 = data[i + 2];
          const index1 = colorToIndexMap.get(`${r1},${g1},${b1}`) ?? 0;

          // Get the palette index for the second pixel (if it exists)
          let index2 = 0;
          if (i + 3 < data.length) {
            const r2 = data[i + 3],
              g2 = data[i + 4],
              b2 = data[i + 5];
            index2 = colorToIndexMap.get(`${r2},${g2},${b2}`) ?? 0;
          }

          // Pack the two 4-bit indices into a single byte
          const byte = (index1 << 4) | index2;
          packedData[packedDataIndex++] = byte;
        }

        // Create a self-describing 12-byte header
        const header = Buffer.alloc(12);
        header.writeUInt32LE(info.width, 0); // Image width
        header.writeUInt32LE(info.height, 4); // Image height
        header.writeUInt32LE(4, 8); // Bits per pixel

        // Concatenate header and the packed data
        const outputBuffer = Buffer.concat([header, packedData]);

        await fs.writeFile(outputFilePath, outputBuffer);
        logger('info', `Pre-processed ${file} -> ${outputFileName} (4-bit indexed, packed)`);

        // Save a PNG version for visual inspection (using original data for clarity)
        const debugPngPath = path.join(zLevelOutputDir, `DEBUG_${x}_${y}_${z}.png`);
        await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).toFile(debugPngPath);

        // Update the main index
        indexData.tiles.push({ x, y, file: outputFileName });
        indexData.minX = Math.min(indexData.minX, x);
        indexData.maxX = Math.max(indexData.maxX, x);
        indexData.minY = Math.min(indexData.minY, y);
        indexData.maxY = Math.max(indexData.maxY, y);
      } catch (error) {
        logger('error', `Error processing ${file}: ${error.message}`);
      }
    }

    await fs.writeFile(indexFilePath, JSON.stringify(indexData, null, 2));
    logger('info', `Minimap pre-processing complete. Index written to ${indexFilePath}`);
  } catch (error) {
    logger('error', `Failed to read minimap directory or other file system error: ${error.message}`);
  }
}

preprocessMinimaps().catch((err) => {
  logger('error', `Fatal error during pre-processing: ${err.message}`, err);
  process.exit(1);
});
