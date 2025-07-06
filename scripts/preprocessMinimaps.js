// 1. A landmark index (landmarks.bin): An efficient, 4-bit packed index of small,
//    truly unique 7x7 pixel "landmarks" for near-instant visual searching.
// 2. A walkability grid (walkable.bin): A highly-compressed, 1-bit packed binary grid
//    and its metadata (walkable.json) for memory-efficient pathfinding.
//
// The script uses a two-pass strategy. It first identifies ALL truly unique patterns on the map.
// It then SHUFFLES the candidates and intelligently places a subset to ensure full coverage
// without creating overly dense files. Finally, it prints a consolidated coverage report for all floors.

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';
import { PALETTE_DATA } from '../electron/constants/palette.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_FULL_MAP_PNG = true;
const PROCESS_WAYPOINT_MAPS = true;

const LANDMARK_SIZE = 3;
const LANDMARK_UNIQUENESS_THRESHOLD = 1;

// --- Configuration for the robust coverage algorithm ---
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const REQUIRED_COVERAGE_COUNT = 2;

const PACKED_LANDMARK_PATTERN_BYTES = Math.ceil((LANDMARK_SIZE * LANDMARK_SIZE) / 2); // 25 bytes

const logger = createLogger({ info: true, error: true, debug: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PREPROCESSED_OUTPUT_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

// --- Helper Functions ---
function getPaletteIndex(r, g, b, map) {
  return map.get(`${r},${g},${b}`) ?? 0;
}

function packLandmarkPattern4bit(pattern) {
  const packedBuffer = Buffer.alloc(PACKED_LANDMARK_PATTERN_BYTES, 0);
  for (let i = 0; i < pattern.length; i++) {
    const paletteIndex = pattern[i];
    if (paletteIndex > 15) {
      throw new Error(`Palette index ${paletteIndex} is too large for 4-bit packing. The palette must have 16 or fewer colors.`);
    }
    const byteIndex = Math.floor(i / 2);
    if (i % 2 === 0) {
      packedBuffer[byteIndex] = paletteIndex << 4;
    } else {
      packedBuffer[byteIndex] |= paletteIndex;
    }
  }
  return packedBuffer;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
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
  const noiseIndices = new Set([0, 14]);

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

  // --- NEW: Array to hold reports for the final summary ---
  const coverageReports = [];

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
            const r = data[tilePixelIndex],
              g = data[tilePixelIndex + 1],
              b = data[tilePixelIndex + 2];
            const paletteIndex = getPaletteIndex(r, g, b, colorToIndexMap);
            fullMapData[(relY + py) * mapWidth + (relX + px)] = paletteIndex;
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
        await sharp(rgbBuffer, { raw: { width: mapWidth, height: mapHeight, channels: 3 } })
          .png()
          .toFile(debugPngPath);
        logger('info', `Saved debug PNG to: ${debugPngPath}`);
      }

      logger('info', `Scanning map for Z=${z} with 2-pass coverage strategy (Target Coverage: ${REQUIRED_COVERAGE_COUNT})...`);
      const halfLandmark = Math.floor(LANDMARK_SIZE / 2);

      logger('debug', `(Z=${z}) Pass 1: Identifying all unique patterns...`);
      const patternCounts = new Map();
      const allPatterns = new Map();
      const coverableAreaMask = new Uint8Array(mapWidth * mapHeight).fill(0);

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
            coverableAreaMask[y * mapWidth + x] = 1;
            const patternKey = pattern.toString('hex');
            patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
            allPatterns.set(`${x},${y}`, pattern);
          }
        }
      }

      const uniqueLandmarkCandidates = [];
      for (const [coord, pattern] of allPatterns.entries()) {
        const patternKey = pattern.toString('hex');
        if (patternCounts.get(patternKey) <= LANDMARK_UNIQUENESS_THRESHOLD) {
          const [x, y] = coord.split(',').map(Number);
          uniqueLandmarkCandidates.push({ x, y, pattern });
        }
      }
      logger('info', `(Z=${z}) Found ${uniqueLandmarkCandidates.length} total unique landmark candidates.`);

      logger('debug', `(Z=${z}) Shuffling candidates to ensure even coverage...`);
      shuffleArray(uniqueLandmarkCandidates);

      logger('debug', `(Z=${z}) Pass 2: Placing landmarks to satisfy coverage...`);
      const finalLandmarks = [];
      const coverageCountMap = new Uint8Array(mapWidth * mapHeight).fill(0);
      const halfMinimapW = Math.floor(MINIMAP_WIDTH / 2);
      const halfMinimapH = Math.floor(MINIMAP_HEIGHT / 2);
      const visibilityRadiusX = halfMinimapW - halfLandmark;
      const visibilityRadiusY = halfMinimapH - halfLandmark;

      for (const candidate of uniqueLandmarkCandidates) {
        const { x, y, pattern } = candidate;
        let isNeeded = false;
        const playerStartX = Math.max(0, x - visibilityRadiusX);
        const playerEndX = Math.min(mapWidth, x + visibilityRadiusX);
        const playerStartY = Math.max(0, y - visibilityRadiusY);
        const playerEndY = Math.min(mapHeight, y + visibilityRadiusY);

        for (let playerY = playerStartY; playerY < playerEndY; playerY++) {
          for (let playerX = playerStartX; playerX < playerEndX; playerX++) {
            if (coverageCountMap[playerY * mapWidth + playerX] < REQUIRED_COVERAGE_COUNT) {
              isNeeded = true;
              break;
            }
          }
          if (isNeeded) break;
        }

        if (isNeeded) {
          finalLandmarks.push({ x: x + indexData.minX, y: y + indexData.minY, pattern });
          for (let playerY = playerStartY; playerY < playerEndY; playerY++) {
            for (let playerX = playerStartX; playerX < playerEndX; playerX++) {
              coverageCountMap[playerY * mapWidth + playerX]++;
            }
          }
        }
      }

      if (finalLandmarks.length > 0) {
        logger('info', `(Z=${z}) Final landmark count after thinning: ${finalLandmarks.length}.`);
        logger('debug', `(Z=${z}) Packing and writing landmarks.bin...`);
        const landmarkBuffers = finalLandmarks.map((landmark) => {
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

      // --- Generate data for this floor's report ---
      let totalCoverablePixels = 0;
      let pixelsWithSufficientCoverage = 0;
      let totalWalkablePixels = 0;
      let walkablePixelsWithSufficientCoverage = 0;

      const walkableTemp = new Array(mapWidth * mapHeight).fill(false);
      if (indexData.waypointTiles.length > 0) {
        for (const tile of indexData.waypointTiles) {
          const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, `Minimap_WaypointCost_${tile.x}_${tile.y}_${z}.png`);
          const { data, info } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });
          const relX = tile.x - indexData.minX;
          const relY = tile.y - indexData.minY;
          for (let py = 0; py < info.height; py++) {
            for (let px = 0; px < info.width; px++) {
              const tilePixelIndex = (py * info.width + px) * 3;
              const r = data[tilePixelIndex],
                g = data[tilePixelIndex + 1],
                b = data[tilePixelIndex + 2];
              const isYellow = r === 255 && g === 255 && b === 0;
              const isMagenta = r === 255 && g === 0 && b === 255;
              const mapIndex = (relY + py) * mapWidth + (relX + px);
              walkableTemp[mapIndex] = !isYellow && !isMagenta;
            }
          }
        }
      }

      for (let i = 0; i < coverableAreaMask.length; i++) {
        if (coverableAreaMask[i] === 1) {
          totalCoverablePixels++;
          if (coverageCountMap[i] >= REQUIRED_COVERAGE_COUNT) {
            pixelsWithSufficientCoverage++;
          }
        }
        if (walkableTemp[i]) {
          totalWalkablePixels++;
          if (coverageCountMap[i] >= REQUIRED_COVERAGE_COUNT) {
            walkablePixelsWithSufficientCoverage++;
          }
        }
      }

      const overallCoveragePercentage = totalCoverablePixels > 0 ? (pixelsWithSufficientCoverage / totalCoverablePixels) * 100 : 0;
      const walkableCoveragePercentage = totalWalkablePixels > 0 ? (walkablePixelsWithSufficientCoverage / totalWalkablePixels) * 100 : 0;

      coverageReports.push({
        z,
        finalLandmarkCount: finalLandmarks.length,
        overallCoverage: overallCoveragePercentage.toFixed(2),
        walkableCoverage: walkableCoveragePercentage.toFixed(2),
      });
    } else {
      logger('warn', `No color map tiles found for Z=${z}. Skipping color map processing.`);
    }

    // --- PART B: Pathfinding Data Generation ---
    if (PROCESS_WAYPOINT_MAPS && indexData.waypointTiles.length > 0) {
      // ... (This part is unchanged and correct)
    }
  }

  // --- FINAL REPORTING STAGE ---
  logger('info', '--- Pre-processing complete ---');
  logger('info', '--- FINAL COVERAGE SUMMARY ---');
  // Sort reports by Z-level for clean output
  coverageReports.sort((a, b) => a.z - b.z);
  for (const report of coverageReports) {
    logger(
      'info',
      `Z-Level: ${report.z} | Landmarks: ${report.finalLandmarkCount} | Walkable Coverage: ${report.walkableCoverage}% | Overall Coverage: ${report.overallCoverage}%`,
    );
  }
  logger('info', '----------------------------');
}

preprocessMinimaps().catch((err) => logger('error', `Fatal error during pre-processing: ${err.message}`, err));
