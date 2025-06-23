// This script pre-processes minimap PNGs into two optimized formats:
// 1. A single packed 4-bit map file per Z-level (map.bin): This file contains the entire map for one floor,
//    used for the fallback search.
// 2. A landmark index (landmarks.bin): An efficient index of small, unique 7x7 pixel "landmarks"
//    used for a near-instant primary search.
//
// As an additional function, it can also pre-process and stitch the waypoint cost maps into a single
// debug PNG per z-level.
//
// The script first assembles the entire map for a z-level from all its PNG tiles, then scours it for
// unique patterns to create the landmark index. This heavy, one-time computation makes the
// real-time search in the application incredibly fast.
//
// It can also optionally save:
// - A full-size debug PNG of each assembled map.
// - A small PNG for each unique landmark found.
// - A full-size debug PNG showing the map areas covered by the landmark search.
// - A full-size debug PNG of each assembled waypoint cost map.

// Visual map data
// Each file with a name of the form Minimap_Color_x_y_z.png contains the visual map data for a tile of 256×256 pixels. The coordinates in the file name look like this:

// x is the absolute X coordinate of the top-left pixel of the tile. At the moment, this value ranges from 31744 (left-most tile) to 33536 (right-most tile), but this range could be extended in the future if CipSoft decides to add new areas outside the current boundaries of the map.
// y is the absolute Y coordinate of the top-left pixel of the tile. It currently goes from 30976 (top-most tile) to 32768 (bottom-most tile).
// z is the floor ID of the tile. 0 is the highest floor; 7 is the ground floor; 15 is the deepest underground.

// Pathfinding data
// Each file with a name of the form Minimap_WaypointCost_x_y_z.png contains the pathfinding data for a tile of 256×256 pixels. This is the map that is used for pathfinding, e.g. to calculate the fastest route to a destination when map-clicking. Each of these pixels represents the walking speed friction on a specific tile. Each of the RGB color components (in most cases R=G=B) contains the friction value at a given position. In general, the darker the color, the lower the friction value, and the higher your movement speed on that tile. There are two special cases: magenta (#FF00FF) tiles are unexplored, and yellow (#FFFF00) tiles are non-walkable.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_FULL_MAP_PNG = true;
const SAVE_DEBUG_LANDMARK_PNGS = false;
const CALCULATE_LANDMARK_COVERAGE = true;
const SAVE_DEBUG_COVERAGE_MAP_PNG = true;
const PROCESS_WAYPOINT_MAPS = true; // <<< NEW: Set to true to process and stitch waypoint cost maps.

const LANDMARK_SIZE = 7;
const LANDMARK_UNIQUENESS_THRESHOLD = 1;

const SEARCH_WINDOW_WIDTH = 106;
const SEARCH_WINDOW_HEIGHT = 109;

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
  const allFiles = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
  const zLevelIndexData = new Map();

  const colorRegex = /Minimap_Color_(\d+)_(\d+)_(\d+)\.png/;
  const waypointRegex = /Minimap_WaypointCost_(\d+)_(\d+)_(\d+)\.png/;

  for (const file of allFiles) {
    const colorMatch = file.match(colorRegex);
    const waypointMatch = file.match(waypointRegex);
    const match = colorMatch || waypointMatch;

    if (!match) continue;

    const [_, x, y, z] = match.map(Number);

    if (!zLevelIndexData.has(z)) {
      zLevelIndexData.set(z, { z, colorTiles: [], waypointTiles: [], minX: x, maxX: x, minY: y, maxY: y });
    }
    const indexData = zLevelIndexData.get(z);

    if (colorMatch) {
      indexData.colorTiles.push({ x, y });
    } else if (waypointMatch) {
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

    let hasProcessedColorMap = false;

    // --- A: Process Color Maps (Original Logic) ---
    if (indexData.colorTiles.length > 0) {
      hasProcessedColorMap = true;
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

      logger('info', `Scanning map for Z=${z} to find unique ${LANDMARK_SIZE}x${LANDMARK_SIZE} landmarks... (This may take a while)`);
      const landmarks = [];
      const patternCounts = new Map();
      const halfLandmark = Math.floor(LANDMARK_SIZE / 2);

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
        // ... (Landmark PNG saving, coverage calculation, and landmark.bin saving logic remains the same)
        // This part is unchanged
        logger('info', `Found ${landmarks.length} unique landmarks for Z=${z}. Writing to landmarks.bin.`);
        const landmarkDataSize = 4 + 4 + LANDMARK_SIZE * LANDMARK_SIZE + 4; // x, y, pattern, and padding to 64 bytes
        const landmarkBuffer = Buffer.alloc(landmarks.length * landmarkDataSize);
        for (let i = 0; i < landmarks.length; i++) {
          const offset = i * landmarkDataSize;
          landmarkBuffer.writeUInt32LE(landmarks[i].x, offset);
          landmarkBuffer.writeUInt32LE(landmarks[i].y, offset + 4);
          landmarks[i].pattern.copy(landmarkBuffer, offset + 8);
        }
        await fs.writeFile(path.join(zLevelOutputDir, 'landmarks.bin'), landmarkBuffer);
      } else {
        logger('warn', `No unique landmarks found for Z=${z}. This floor will rely entirely on fallback search.`);
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
      header.writeUInt32LE(4, 8); // 4-bit
      const outputBuffer = Buffer.concat([header, packedMapData]);
      await fs.writeFile(path.join(zLevelOutputDir, 'map.bin'), outputBuffer);
    } else {
      logger('warn', `No color map tiles found for Z=${z}. Skipping color map processing.`);
    }

    // --- B: Process Waypoint Cost Maps (New Logic) ---
    if (PROCESS_WAYPOINT_MAPS) {
      if (indexData.waypointTiles.length === 0) {
        logger('warn', `No waypoint map tiles found for Z=${z}. Skipping waypoint map processing.`);
      } else {
        logger('info', `Assembling ${mapWidth}x${mapHeight} waypoint map for Z=${z} from ${indexData.waypointTiles.length} PNGs...`);

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
            background: { r: 255, g: 0, b: 255 }, // Magenta for unexplored areas
          },
        })
          .composite(compositeOps)
          .png()
          .toFile(waypointPngPath);

        logger('info', `Saved waypoint debug PNG to: ${waypointPngPath}`);
      }
    }

    // --- C: Save index.json ---
    // Only save an index if we actually processed the main color map, since it references map.bin
    if (hasProcessedColorMap) {
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
  }
  logger('info', '--- Minimap pre-processing complete ---');
}

preprocessMinimaps().catch((err) => logger('error', `Fatal error during pre-processing: ${err.message}`, err));
