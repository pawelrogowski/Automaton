// This script pre-processes minimap PNGs and WaypointCost PNGs into optimized formats:
// 1. A landmark index (landmarks.bin): An efficient, 4-bit packed index of small,
//    unique 7x7 pixel "landmarks" for near-instant visual searching.
// 2. A walkability grid (walkable.bin): A highly-compressed, 1-bit packed binary grid
//    and its metadata (walkable.json) for memory-efficient pathfinding.
//
// As an additional function, it can also stitch the waypoint cost maps into a single
// debug PNG per z-level.
//
// The script first assembles the entire map for a z-level from all its PNG tiles, then scours it for
// unique patterns to create the landmark index. This heavy, one-time computation makes the
// real-time search and pathfinding in the application incredibly fast.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';
import { PALETTE_DATA } from '../electron/constants/palette.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_FULL_MAP_PNG = true;
// This flag now controls both the debug PNG and the new binary pathfinding data generation.
const PROCESS_WAYPOINT_MAPS = true;

const LANDMARK_SIZE = 7;
const LANDMARK_UNIQUENESS_THRESHOLD = 1;
// Each 7x7=49 pixel pattern is packed at 4-bits per pixel.
// 49 pixels / 2 pixels-per-byte = 24.5, which we round up.
const PACKED_LANDMARK_PATTERN_BYTES = Math.ceil((LANDMARK_SIZE * LANDMARK_SIZE) / 2); // 25 bytes

const logger = createLogger({ info: true, error: true, debug: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PREPROCESSED_OUTPUT_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

// --- Helper Functions ---
function getPaletteIndex(r, g, b, map) {
  return map.get(`${r},${g},${b}`) ?? 0;
}

/**
 * Packs a 49-element array of 4-bit palette indices into a 25-byte Buffer.
 * Two 4-bit palette indices are packed into each byte.
 * @param {Buffer | Uint8Array} pattern - The 49-byte unpacked pattern of 8-bit indices.
 * @returns {Buffer} The 25-byte packed buffer.
 */
function packLandmarkPattern4bit(pattern) {
  const packedBuffer = Buffer.alloc(PACKED_LANDMARK_PATTERN_BYTES, 0);
  for (let i = 0; i < pattern.length; i++) {
    const paletteIndex = pattern[i];
    if (paletteIndex > 15) {
      throw new Error(`Palette index ${paletteIndex} is too large for 4-bit packing. The palette must have 16 or fewer colors.`);
    }

    const byteIndex = Math.floor(i / 2);
    if (i % 2 === 0) {
      // The first pixel of a pair goes into the high 4 bits (e.g., 11110000)
      packedBuffer[byteIndex] = paletteIndex << 4;
    } else {
      // The second pixel of a pair goes into the low 4 bits (e.g., 00001111)
      packedBuffer[byteIndex] |= paletteIndex;
    }
  }
  return packedBuffer;
}

async function preprocessMinimaps() {
  logger('info', '--- Starting ADVANCED Minimap & 1-BIT Pathfinding Pre-processing ---');

  const palette = PALETTE_DATA;
  if (palette.length > 16) {
    logger('error', `FATAL: Palette has ${palette.length} colors. 4-bit packing requires 16 or fewer colors.`);
    process.exit(1);
  }
  const colorToIndexMap = new Map();
  palette.forEach((color, index) => {
    colorToIndexMap.set(`${color.r},${color.g},${color.b}`, index);
  });
  const noiseIndices = new Set([0, 14]); // Black and White indices from your palette

  await fs.mkdir(PREPROCESSED_OUTPUT_DIR, { recursive: true });

  // --- STAGE 1: Scan file system to build an index of all maps and their dimensions ---
  logger('info', '--- STAGE 1: Scanning PNGs to determine map boundaries for each Z-level ---');
  const allFiles = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
  const zLevelIndexData = new Map();

  const colorRegex = /Minimap_Color_(\d+)_(\d+)_(\d+)\.png/;
  const waypointRegex = /Minimap_WaypointCost_(\d+)_(\d+)_(\d+)\.png/;

  for (const file of allFiles) {
    const match = file.match(colorRegex) || file.match(waypointRegex);
    if (!match) continue;

    const [_, x, y, z] = match.map(Number);

    if (!zLevelIndexData.has(z)) {
      zLevelIndexData.set(z, { z, colorTiles: [], waypointTiles: [], minX: x, maxX: x, minY: y, maxY: y });
    }
    const indexData = zLevelIndexData.get(z);

    if (file.startsWith('Minimap_Color')) {
      indexData.colorTiles.push({ x, y });
    } else if (file.startsWith('Minimap_WaypointCost')) {
      indexData.waypointTiles.push({ x, y });
    }

    indexData.minX = Math.min(indexData.minX, x);
    indexData.maxX = Math.max(indexData.maxX, x);
    indexData.minY = Math.min(indexData.minY, y);
    indexData.maxY = Math.max(indexData.maxY, y);
  }
  logger('info', '--- STAGE 1 Complete. Map boundaries calculated. ---');

  // --- STAGE 2: Assemble full maps, generate landmarks, and save data ---
  logger('info', '--- STAGE 2: Assembling full maps, generating landmarks, and saving data ---');
  for (const [z, indexData] of zLevelIndexData.entries()) {
    logger('info', `--- Processing Z-Level ${z} ---`);
    const zLevelOutputDir = path.join(PREPROCESSED_OUTPUT_DIR, `z${z}`);
    await fs.mkdir(zLevelOutputDir, { recursive: true });

    const mapWidth = indexData.maxX - indexData.minX + 256;
    const mapHeight = indexData.maxY - indexData.minY + 256;

    // --- PART A: Landmark Generation ---
    if (indexData.colorTiles.length > 0) {
      const fullMapData = new Uint8Array(mapWidth * mapHeight);
      fullMapData.fill(0);

      logger('info', `Assembling ${mapWidth}x${mapHeight} color map for Z=${z} from ${indexData.colorTiles.length} PNGs...`);
      for (const tile of indexData.colorTiles) {
        const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, `Minimap_Color_${tile.x}_${tile.y}_${z}.png`);
        const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });

        const relX = tile.x - indexData.minX;
        const relY = tile.y - indexData.minY;

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

      if (SAVE_DEBUG_FULL_MAP_PNG) {
        logger('info', `Generating debug PNG for Z=${z}...`);
        const rgbBuffer = Buffer.alloc(mapWidth * mapHeight * 3);
        for (let i = 0; i < fullMapData.length; i++) {
          const paletteIndex = fullMapData[i];
          const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 };
          rgbBuffer[i * 3] = color.r;
          rgbBuffer[i * 3 + 1] = color.g;
          rgbBuffer[i * 3 + 2] = color.b;
        }
        const debugPngPath = path.join(zLevelOutputDir, `_map_debug_z${z}.png`);
        await sharp(rgbBuffer, {
          raw: { width: mapWidth, height: mapHeight, channels: 3 },
        })
          .png()
          .toFile(debugPngPath);
        logger('info', `Saved debug PNG to: ${debugPngPath}`);
      }

      logger('info', `Scanning map for Z=${z} to find unique ${LANDMARK_SIZE}x${LANDMARK_SIZE} landmarks...`);
      const landmarks = [];
      const patternCounts = new Map();
      const halfLandmark = Math.floor(LANDMARK_SIZE / 2);

      // First pass to count all valid patterns
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

      // Second pass to collect the unique ones
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
              patternCounts.delete(patternKey);
            }
          }
        }
      }

      if (landmarks.length > 0) {
        logger('info', `Found ${landmarks.length} unique landmarks for Z=${z}. Packing (4-bit) and writing to landmarks.bin.`);
        const landmarkBuffers = landmarks.map((landmark) => {
          const header = Buffer.alloc(8);
          header.writeUInt32LE(landmark.x, 0);
          header.writeUInt32LE(landmark.y, 4);
          const packedPattern = packLandmarkPattern4bit(landmark.pattern);
          return Buffer.concat([header, packedPattern]);
        });
        const finalBuffer = Buffer.concat(landmarkBuffers);
        await fs.writeFile(path.join(zLevelOutputDir, 'landmarks.bin'), finalBuffer);
      } else {
        logger('warn', `No unique landmarks found for Z=${z}. Position finding will be unavailable for this floor.`);
      }
    } else {
      logger('warn', `No color map tiles found for Z=${z}. Skipping color map processing.`);
    }

    // --- PART B: Pathfinding Data Generation ---
    if (PROCESS_WAYPOINT_MAPS) {
      if (indexData.waypointTiles.length === 0) {
        logger('warn', `No waypoint map tiles found for Z=${z}. Skipping waypoint map processing.`);
      } else {
        // --- Sub-part 1: Generate the binary walkability grid (NEW) ---
        logger('info', `Assembling ${mapWidth}x${mapHeight} binary walkability grid for Z=${z}...`);
        const walkableTemp = new Array(mapWidth * mapHeight).fill(false);
        for (const tile of indexData.waypointTiles) {
          const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, `Minimap_WaypointCost_${tile.x}_${tile.y}_${z}.png`);
          const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });
          const relX = tile.x - indexData.minX;
          const relY = tile.y - indexData.minY;
          for (let py = 0; py < info.height; py++) {
            for (let px = 0; px < info.width; px++) {
              const tilePixelIndex = (py * info.width + px) * 3;
              const r = data[tilePixelIndex];
              const g = data[tilePixelIndex + 1];
              const b = data[tilePixelIndex + 2];
              const isYellow = r === 255 && g === 255 && b === 0;
              const isMagenta = r === 255 && g === 0 && b === 255;
              const mapIndex = (relY + py) * mapWidth + (relX + px);
              walkableTemp[mapIndex] = !isYellow && !isMagenta;
            }
          }
        }

        const packedSize = Math.ceil((mapWidth * mapHeight) / 8);
        const packedWalkableBuffer = Buffer.alloc(packedSize, 0);
        for (let i = 0; i < walkableTemp.length; i++) {
          if (walkableTemp[i]) {
            const byteIndex = Math.floor(i / 8);
            const bitIndex = i % 8;
            packedWalkableBuffer[byteIndex] |= 1 << bitIndex;
          }
        }

        const binPath = path.join(zLevelOutputDir, 'walkable.bin');
        await fs.writeFile(binPath, packedWalkableBuffer);
        logger('info', `Saved 1-bit packed walkability grid to: ${binPath}`);

        const metadata = {
          z,
          minX: indexData.minX,
          minY: indexData.minY,
          width: mapWidth,
          height: mapHeight,
          bitsPerTile: 1,
        };
        const jsonPath = path.join(zLevelOutputDir, 'walkable.json');
        await fs.writeFile(jsonPath, JSON.stringify(metadata, null, 2));
        logger('info', `Saved walkability grid metadata to: ${jsonPath}`);

        // --- Sub-part 2: Generate the debug waypoint PNG (ORIGINAL) ---
        logger('info', `Assembling debug waypoint map for Z=${z} from ${indexData.waypointTiles.length} PNGs...`);
        const compositeOps = indexData.waypointTiles.map((tile) => ({
          input: path.join(TIBIA_MINIMAP_BASE_PATH, `Minimap_WaypointCost_${tile.x}_${tile.y}_${z}.png`),
          top: tile.y - indexData.minY,
          left: tile.x - indexData.minX,
        }));
        const waypointPngPath = path.join(zLevelOutputDir, `_waypoint_debug_z${z}.png`);
        await sharp({
          create: {
            width: mapWidth,
            height: mapHeight,
            channels: 3,
            background: { r: 255, g: 0, b: 255 }, // Default background is magenta (unexplored)
          },
        })
          .composite(compositeOps)
          .png()
          .toFile(waypointPngPath);
        logger('info', `Saved waypoint debug PNG to: ${waypointPngPath}`);
      }
    }
  }
  logger('info', '--- Pre-processing complete ---');
}

preprocessMinimaps().catch((err) => logger('error', `Fatal error during pre-processing: ${err.message}`, err));
