// This script pre-processes Tibia's minimap PNG files into a highly optimized custom binary format.
// It reads a pre-generated `palette.json` file which contains all unique colors found on the minimap.
// For each pixel in a PNG tile, it finds the color's corresponding index (0-14) in the palette.
// Since there are fewer than 16 colors, each index only needs 4 bits of storage. The script "packs"
// the 4-bit indices of two adjacent pixels into a single 8-bit byte, drastically reducing file size.
// The final output is a set of `.bin` files (one per tile per z-level) with a small header, the packed pixel data,
// and an `index.json` file in each z-level directory to map coordinates to these new, highly efficient files.
// A configuration flag at the top of the script allows for optionally saving a PNG version of each tile for visual verification.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

// --- CONFIGURATION ---
// Set this to true to save a PNG copy of each processed tile for visual inspection.
// These PNGs are helpful for debugging but are not used by the application.
const SAVE_DEBUG_PNG = false;

const logger = createLogger({ info: true, error: true, debug: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PREPROCESSED_OUTPUT_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
const PALETTE_PATH = path.join(PREPROCESSED_OUTPUT_DIR, 'palette.json');

async function preprocessMinimaps() {
  logger('info', '--- Starting Minimap Pre-processing for ALL Z-Levels ---');
  logger('info', `Configuration: Save debug PNG files is set to '${SAVE_DEBUG_PNG}'.`);

  // Load the color palette and create a fast lookup map from color to index
  logger('info', `Loading palette from ${PALETTE_PATH}...`);
  const palette = JSON.parse(await fs.readFile(PALETTE_PATH, 'utf-8'));
  const colorToIndexMap = new Map();
  palette.forEach((color, index) => {
    colorToIndexMap.set(`${color.r},${color.g},${color.b}`, index);
  });
  logger('info', `Palette loaded with ${palette.length} colors. Using 4-bit indexed format.`);

  // Setup paths and data structures
  logger('info', `Reading from: ${TIBIA_MINIMAP_BASE_PATH}`);
  logger('info', `Writing to: ${PREPROCESSED_OUTPUT_DIR}`);
  await fs.mkdir(PREPROCESSED_OUTPUT_DIR, { recursive: true });

  // This map will hold the index data for each discovered Z-level.
  // Key: Z-level (e.g., 7), Value: indexData object
  const zLevelIndexData = new Map();

  try {
    const files = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
    const minimapPngFiles = files.filter((file) => file.startsWith('Minimap_Color_') && file.endsWith('.png'));

    logger('info', `Found ${minimapPngFiles.length} minimap PNG files to process.`);

    for (const file of minimapPngFiles) {
      const parts = file.match(/Minimap_Color_(\d+)_(\d+)_(\d+)\.png/);
      if (!parts) {
        logger('warn', `Skipping malformed file name: ${file}`);
        continue;
      }

      const x = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      const z = parseInt(parts[3], 10);

      // Dynamically create output directory for the current Z-level
      const zLevelOutputDir = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`);
      await fs.mkdir(zLevelOutputDir, { recursive: true });

      // Get or create the index data object for the current Z-level
      let indexData = zLevelIndexData.get(z);
      if (!indexData) {
        logger('info', `Discovered new Z-level: ${z}. Creating index for it.`);
        indexData = {
          z: z,
          tiles: [],
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
        };
        zLevelIndexData.set(z, indexData);
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
        logger('debug', `Pre-processed ${file} -> ${path.join(`z${z}`, outputFileName)}`);

        // *** CHANGE: Conditionally save a PNG version for visual inspection ***
        if (SAVE_DEBUG_PNG) {
          const debugPngPath = path.join(zLevelOutputDir, `DEBUG_${x}_${y}_${z}.png`);
          await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).toFile(debugPngPath);
          logger('debug', `Saved debug PNG: ${path.basename(debugPngPath)}`);
        }

        // Update the main index for the specific Z-level
        indexData.tiles.push({ x, y, file: outputFileName });
        indexData.minX = Math.min(indexData.minX, x);
        indexData.maxX = Math.max(indexData.maxX, x);
        indexData.minY = Math.min(indexData.minY, y);
        indexData.maxY = Math.max(indexData.maxY, y);
      } catch (error) {
        logger('error', `Error processing ${file}: ${error.message}`);
      }
    }

    // After processing all files, write the index.json for each Z-level
    logger('info', 'All tiles processed. Writing final index files...');
    for (const [z, indexData] of zLevelIndexData.entries()) {
      if (indexData.tiles.length === 0) {
        logger('warn', `Skipping index for Z-level ${z} as no valid tiles were processed.`);
        continue;
      }
      const indexFilePath = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`, 'index.json');
      await fs.writeFile(indexFilePath, JSON.stringify(indexData, null, 2));
      logger('info', `Index for Z-level ${z} written to ${indexFilePath}`);
    }
    logger('info', '--- Minimap pre-processing complete ---');
  } catch (error) {
    logger('error', `Failed to read minimap directory or other file system error: ${error.message}`);
  }
}

preprocessMinimaps().catch((err) => {
  logger('error', `Fatal error during pre-processing: ${err.message}`, err);
  process.exit(1);
});
