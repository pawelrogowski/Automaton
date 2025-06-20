// This script pre-processes minimap PNGs into two optimized formats:
// 1. Packed 4-bit Tiles (.bin): The original method, compressing the full map for a fallback search.
// 2. Landmark Index (.bin): A NEW, highly efficient index of small, unique 7x7 pixel "landmarks".
//    This index is used for a near-instant primary search in the main application.
//
// The script first assembles the entire map for a z-level, then scours it for unique, high-contrast
// 7x7 patterns, storing them and their coordinates. This heavy, one-time computation makes the
// real-time search in the application incredibly fast.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_PNG = false;
const LANDMARK_SIZE = 7; // The dimension of landmarks (e.g., 7x7 pixels). Must be odd.
const LANDMARK_UNIQUENESS_THRESHOLD = 1; // A landmark is only saved if it appears this many times or fewer.

const logger = createLogger({ info: true, error: true, debug: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PREPROCESSED_OUTPUT_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
const PALETTE_PATH = path.join(PREPROCESSED_OUTPUT_DIR, 'palette.json');

// --- Helper Functions ---
function getPaletteIndex(r, g, b, map) {
  return map.get(`${r},${g},${b}`) ?? 0;
}

async function preprocessMinimaps() {
  logger('info', '--- Starting ADVANCED Minimap Pre-processing ---');

  // Load palette
  const palette = JSON.parse(await fs.readFile(PALETTE_PATH, 'utf-8'));
  const colorToIndexMap = new Map();
  palette.forEach((color, index) => {
    colorToIndexMap.set(`${color.r},${color.g},${color.b}`, index);
  });
  const noiseIndices = new Set([0, 14]); // Black and White indices from palette.json

  await fs.mkdir(PREPROCESSED_OUTPUT_DIR, { recursive: true });

  // --- STAGE 1: Process original PNGs into packed .bin tiles and build map index ---
  logger('info', '--- STAGE 1: Processing PNGs into packed tiles and building map index ---');
  const files = (await fs.readdir(TIBIA_MINIMAP_BASE_PATH)).filter((f) => f.startsWith('Minimap_Color_') && f.endsWith('.png'));
  const zLevelIndexData = new Map();

  for (const file of files) {
    const parts = file.match(/Minimap_Color_(\d+)_(\d+)_(\d+)\.png/);
    if (!parts) continue;
    const [_, x, y, z] = parts.map(Number);

    const zLevelOutputDir = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`);
    await fs.mkdir(zLevelOutputDir, { recursive: true });

    if (!zLevelIndexData.has(z)) {
      zLevelIndexData.set(z, { z, tiles: [], minX: x, maxX: x, minY: y, maxY: y });
    }
    const indexData = zLevelIndexData.get(z);
    indexData.tiles.push({ x, y, file: `Minimap_Color_${x}_${y}.bin` });
    indexData.minX = Math.min(indexData.minX, x);
    indexData.maxX = Math.max(indexData.maxX, x);
    indexData.minY = Math.min(indexData.minY, y);
    indexData.maxY = Math.max(indexData.maxY, y);

    const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, file);
    const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });
    const pixelCount = info.width * info.height;
    const packedData = Buffer.alloc(Math.ceil(pixelCount / 2));
    for (let i = 0; i < pixelCount * 3; i += 6) {
      const i1 = getPaletteIndex(data[i], data[i + 1], data[i + 2], colorToIndexMap);
      const i2 = i + 3 < data.length ? getPaletteIndex(data[i + 3], data[i + 4], data[i + 5], colorToIndexMap) : 0;
      packedData[i / 6] = (i1 << 4) | i2;
    }
    const header = Buffer.alloc(12);
    header.writeUInt32LE(info.width, 0);
    header.writeUInt32LE(info.height, 4);
    header.writeUInt32LE(4, 8);
    const outputBuffer = Buffer.concat([header, packedData]);
    await fs.writeFile(path.join(zLevelOutputDir, indexData.tiles.at(-1).file), outputBuffer);
  }

  for (const [z, indexData] of zLevelIndexData.entries()) {
    await fs.writeFile(path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`, 'index.json'), JSON.stringify(indexData, null, 2));
  }
  logger('info', '--- STAGE 1 Complete. All packed tiles and indices created. ---');

  // --- STAGE 2: Assemble full maps and generate landmarks for each Z-level ---
  logger('info', '--- STAGE 2: Assembling full maps and generating unique landmarks ---');
  for (const [z, indexData] of zLevelIndexData.entries()) {
    logger('info', `--- Processing Z-Level ${z} for landmarks ---`);
    const mapWidth = indexData.maxX - indexData.minX + 256;
    const mapHeight = indexData.maxY - indexData.minY + 256;
    const fullMapData = new Uint8Array(mapWidth * mapHeight);
    fullMapData.fill(0);

    logger('info', `Assembling ${mapWidth}x${mapHeight} map for Z=${z}...`);
    for (const tile of indexData.tiles) {
      const tilePath = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`, tile.file);
      const tileBuffer = await fs.readFile(tilePath);
      const tileW = tileBuffer.readUInt32LE(0);
      const tileH = tileBuffer.readUInt32LE(4);
      const packed = tileBuffer.subarray(12);
      const relX = tile.x - indexData.minX;
      const relY = tile.y - indexData.minY;
      for (let i = 0; i < packed.length; i++) {
        const byte = packed[i];
        const p1Idx = i * 2,
          p2Idx = i * 2 + 1;
        if (p1Idx < tileW * tileH) fullMapData[(relY + Math.floor(p1Idx / tileW)) * mapWidth + (relX + (p1Idx % tileW))] = byte >> 4;
        if (p2Idx < tileW * tileH) fullMapData[(relY + Math.floor(p2Idx / tileW)) * mapWidth + (relX + (p2Idx % tileW))] = byte & 0x0f;
      }
    }

    logger('info', `Scanning map for Z=${z} to find unique ${LANDMARK_SIZE}x${LANDMARK_SIZE} landmarks... (This may take a while)`);
    const landmarks = [];
    const patternCounts = new Map();
    const halfLandmark = Math.floor(LANDMARK_SIZE / 2);

    // First pass: count all potential landmark patterns
    for (let y = halfLandmark; y < mapHeight - halfLandmark; y++) {
      for (let x = halfLandmark; x < mapWidth - halfLandmark; x++) {
        // *** CORRECTION 1 of 2: Use Buffer.alloc() ***
        const pattern = Buffer.alloc(LANDMARK_SIZE * LANDMARK_SIZE);
        let isValid = true;
        for (let my = 0; my < LANDMARK_SIZE; my++) {
          for (let mx = 0; mx < LANDMARK_SIZE; mx++) {
            const px = fullMapData[(y - halfLandmark + my) * mapWidth + (x - halfLandmark + mx)];
            if (noiseIndices.has(px)) {
              isValid = false;
              break;
            }
            pattern[my * LANDMARK_SIZE + mx] = px;
          }
          if (!isValid) break;
        }

        if (isValid) {
          const patternKey = pattern.toString('hex'); // Use hex for a more efficient key
          patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
        }
      }
    }

    // Second pass: save only the unique landmarks
    for (let y = halfLandmark; y < mapHeight - halfLandmark; y++) {
      for (let x = halfLandmark; x < mapWidth - halfLandmark; x++) {
        // *** CORRECTION 2 of 2: Use Buffer.alloc() ***
        const pattern = Buffer.alloc(LANDMARK_SIZE * LANDMARK_SIZE);
        let isValid = true;
        for (let my = 0; my < LANDMARK_SIZE; my++) {
          for (let mx = 0; mx < LANDMARK_SIZE; mx++) {
            const px = fullMapData[(y - halfLandmark + my) * mapWidth + (x - halfLandmark + mx)];
            if (noiseIndices.has(px)) {
              isValid = false;
              break;
            }
            pattern[my * LANDMARK_SIZE + mx] = px;
          }
          if (!isValid) break;
        }

        if (isValid) {
          const patternKey = pattern.toString('hex');
          if (patternCounts.get(patternKey) <= LANDMARK_UNIQUENESS_THRESHOLD) {
            landmarks.push({ x: x + indexData.minX, y: y + indexData.minY, pattern });
            patternCounts.delete(patternKey); // Avoid adding duplicates
          }
        }
      }
    }

    // Write landmarks to a binary file
    if (landmarks.length > 0) {
      logger('info', `Found ${landmarks.length} unique landmarks for Z=${z}. Writing to landmarks.bin.`);
      const landmarkDataSize = 4 + 4 + LANDMARK_SIZE * LANDMARK_SIZE; // x, y, pattern
      const landmarkBuffer = Buffer.alloc(landmarks.length * landmarkDataSize);
      for (let i = 0; i < landmarks.length; i++) {
        const offset = i * landmarkDataSize;
        landmarkBuffer.writeUInt32LE(landmarks[i].x, offset);
        landmarkBuffer.writeUInt32LE(landmarks[i].y, offset + 4);
        // Now this works because landmarks[i].pattern is a Buffer
        landmarks[i].pattern.copy(landmarkBuffer, offset + 8);
      }
      await fs.writeFile(path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`, 'landmarks.bin'), landmarkBuffer);
    } else {
      logger('warn', `No unique landmarks found for Z=${z}. This floor will rely on fallback search.`);
    }
  }
  logger('info', '--- Minimap pre-processing complete ---');
}

preprocessMinimaps().catch((err) => logger('error', `Fatal error during pre-processing: ${err.message}`, err));
