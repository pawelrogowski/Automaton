// This script pre-processes minimap PNGs into two optimized formats:
// 1. A single packed 4-bit map file per Z-level (map.bin): This file contains the entire map for one floor,
//    used for the fallback search.
// 2. A landmark index (landmarks.bin): An efficient index of small, unique 7x7 pixel "landmarks"
//    used for a near-instant primary search.
//
// The script first assembles the entire map for a z-level from all its PNG tiles, then scours it for
// unique patterns to create the landmark index. This heavy, one-time computation makes the
// real-time search in the application incredibly fast.
// It can also optionally save a full-size debug PNG of each assembled map.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_FULL_MAP_PNG = true; // Set to true to generate a full map PNG for each Z-level for debugging.
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

  // --- STAGE 1: Scan file system to build an index of all maps and their dimensions ---
  logger('info', '--- STAGE 1: Scanning PNGs to determine map boundaries for each Z-level ---');
  const files = (await fs.readdir(TIBIA_MINIMAP_BASE_PATH)).filter((f) => f.startsWith('Minimap_Color_') && f.endsWith('.png'));
  const zLevelIndexData = new Map();

  for (const file of files) {
    const parts = file.match(/Minimap_Color_(\d+)_(\d+)_(\d+)\.png/);
    if (!parts) continue;
    const [_, x, y, z] = parts.map(Number);

    if (!zLevelIndexData.has(z)) {
      zLevelIndexData.set(z, { z, tiles: [], minX: x, maxX: x, minY: y, maxY: y });
    }
    const indexData = zLevelIndexData.get(z);
    indexData.tiles.push({ x, y }); // Store coords to find the PNG later
    indexData.minX = Math.min(indexData.minX, x);
    indexData.maxX = Math.max(indexData.maxX, x);
    indexData.minY = Math.min(indexData.minY, y);
    indexData.maxY = Math.max(indexData.maxY, y);
  }
  logger('info', '--- STAGE 1 Complete. Map boundaries calculated. ---');

  // --- STAGE 2: Assemble full maps, generate landmarks, and save ONE .bin per Z-level ---
  logger('info', '--- STAGE 2: Assembling full maps, generating landmarks, and saving data ---');
  for (const [z, indexData] of zLevelIndexData.entries()) {
    logger('info', `--- Processing Z-Level ${z} ---`);
    const zLevelOutputDir = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`);
    await fs.mkdir(zLevelOutputDir, { recursive: true });

    const mapWidth = indexData.maxX - indexData.minX + 256;
    const mapHeight = indexData.maxY - indexData.minY + 256;
    const fullMapData = new Uint8Array(mapWidth * mapHeight);
    fullMapData.fill(0); // Fill with background color index (black)

    logger('info', `Assembling ${mapWidth}x${mapHeight} map for Z=${z} from PNGs...`);
    for (const tile of indexData.tiles) {
      const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, `Minimap_Color_${tile.x}_${tile.y}_${z}.png`);
      const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });

      const relX = tile.x - indexData.minX;
      const relY = tile.y - indexData.minY;

      // Copy pixel data from the tile into the full map buffer
      for (let py = 0; py < info.height; py++) {
        for (let px = 0; px < info.width; px++) {
          const tilePixelIndex = (py * info.width + px) * 3;
          const r = data[tilePixelIndex];
          const g = data[tilePixelIndex + 1];
          const b = data[tilePixelIndex + 2];
          const paletteIndex = getPaletteIndex(r, g, b, colorToIndexMap);
          const mapIndex = (relY + py) * mapWidth + (relX + px);
          fullMapData[mapIndex] = paletteIndex;
        }
      }
    }

    // *** NEW: OPTIONALLY SAVE A FULL DEBUG PNG OF THE ASSEMBLED MAP ***
    if (SAVE_DEBUG_FULL_MAP_PNG) {
      logger('info', `Generating debug PNG for Z=${z}...`);
      const rgbBuffer = Buffer.alloc(mapWidth * mapHeight * 3);
      for (let i = 0; i < fullMapData.length; i++) {
        const paletteIndex = fullMapData[i];
        const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 }; // Default to black if index is invalid
        rgbBuffer[i * 3] = color.r;
        rgbBuffer[i * 3 + 1] = color.g;
        rgbBuffer[i * 3 + 2] = color.b;
      }
      const debugPngPath = path.join(zLevelOutputDir, `_map_debug_z${z}.png`);
      await sharp(rgbBuffer, {
        raw: {
          width: mapWidth,
          height: mapHeight,
          channels: 3,
        },
      })
        .png()
        .toFile(debugPngPath);
      logger('info', `Saved debug PNG to: ${debugPngPath}`);
    }

    logger('info', `Scanning map for Z=${z} to find unique ${LANDMARK_SIZE}x${LANDMARK_SIZE} landmarks... (This may take a while)`);
    const landmarks = [];
    const patternCounts = new Map();
    const halfLandmark = Math.floor(LANDMARK_SIZE / 2);

    // First pass: count all potential landmark patterns
    for (let y = halfLandmark; y < mapHeight - halfLandmark; y++) {
      for (let x = halfLandmark; x < mapWidth - halfLandmark; x++) {
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
          patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
        }
      }
    }

    // Second pass: save only the unique landmarks
    for (let y = halfLandmark; y < mapHeight - halfLandmark; y++) {
      for (let x = halfLandmark; x < mapWidth - halfLandmark; x++) {
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

    if (landmarks.length > 0) {
      logger('info', `Found ${landmarks.length} unique landmarks for Z=${z}. Writing to landmarks.bin.`);
      const landmarkDataSize = 4 + 4 + LANDMARK_SIZE * LANDMARK_SIZE; // x, y, pattern
      const landmarkBuffer = Buffer.alloc(landmarks.length * landmarkDataSize);
      for (let i = 0; i < landmarks.length; i++) {
        const offset = i * landmarkDataSize;
        landmarkBuffer.writeUInt32LE(landmarks[i].x, offset);
        landmarkBuffer.writeUInt32LE(landmarks[i].y, offset + 4);
        landmarks[i].pattern.copy(landmarkBuffer, offset + 8);
      }
      await fs.writeFile(path.join(zLevelOutputDir, 'landmarks.bin'), landmarkBuffer);
    } else {
      logger('warn', `No unique landmarks found for Z=${z}. This floor will rely on fallback search.`);
    }

    logger('info', `Packing and saving full map data to map.bin for Z=${z}`);
    const packedMapData = Buffer.alloc(Math.ceil((mapWidth * mapHeight) / 2));
    for (let i = 0; i < fullMapData.length; i += 2) {
      const p1 = fullMapData[i];
      const p2 = i + 1 < fullMapData.length ? fullMapData[i + 1] : 0;
      packedMapData[i / 2] = (p1 << 4) | p2;
    }

    const header = Buffer.alloc(12);
    header.writeUInt32LE(mapWidth, 0);
    header.writeUInt32LE(mapHeight, 4);
    header.writeUInt32LE(4, 8); // 4 bits per pixel
    const outputBuffer = Buffer.concat([header, packedMapData]);
    await fs.writeFile(path.join(zLevelOutputDir, 'map.bin'), outputBuffer);

    const newIndexData = {
      z,
      minX: indexData.minX,
      maxX: indexData.maxX,
      minY: indexData.minY,
      maxY: indexData.maxY,
      mapFile: 'map.bin',
      mapWidth,
      mapHeight,
    };
    await fs.writeFile(path.join(zLevelOutputDir, 'index.json'), JSON.stringify(newIndexData, null, 2));
  }
  logger('info', '--- Minimap pre-processing complete ---');
}

preprocessMinimaps().catch((err) => logger('error', `Fatal error during pre-processing: ${err.message}`, err));
