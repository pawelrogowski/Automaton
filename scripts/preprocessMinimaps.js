// preprocessMinimaps.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { exec } from 'child_process';
import zlib from 'zlib';
import pngChunksExtract from 'png-chunks-extract';
import pngChunksEncode from 'png-chunks-encode';
import { createLogger } from '../electron/utils/logger.js';
import { PALETTE_DATA } from '../electron/constants/palette.js';

// --- CONFIGURATION ---
const SAVE_DEBUG_FULL_MAP_PNG = true;
const SAVE_DEBUG_WAYPOINT_MAP_PNG = true;
const PROCESS_WAYPOINT_MAPS = true;

const LANDMARK_SIZE = 5;
const LANDMARK_UNIQUENESS_THRESHOLD = 1;

// --- Configuration for the robust coverage algorithm ---
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const DEFAULT_REQUIRED_COVERAGE_COUNT = 2; // Renamed for clarity

// --- Configuration for the Hybrid Landmark System ---
const ENABLE_HYBRID_LANDMARK_SYSTEM = true; // Master switch to enable/disable the entire new system.
const SAFE_ZONE_RADIUS = 9; // The buffer radius in pixels around walkable areas to define a "safe zone".
const ARTIFICIAL_LANDMARK_GRID_SPACING = 75; // The spacing in pixels for the artificial landmark grid.

const PACKED_LANDMARK_PATTERN_BYTES = Math.ceil(
  (LANDMARK_SIZE * LANDMARK_SIZE) / 2,
);

const logger = createLogger({ info: true, error: true, debug: true });

// --- PATH CONFIGURATION ---
const PROJECT_ROOT = path.join(process.cwd(), '..');
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

const RESOURCES_OUTPUT_DIR = path.join(
  PROJECT_ROOT,
  'resources',
  'preprocessed_minimaps',
);
const PNG_ASSETS_DIR = path.join(
  PROJECT_ROOT,
  'frontend',
  'assets',
  'minimaps',
);

// --- Helper Functions ---
function getPaletteIndex(r, g, b, map) {
  const intKey = (r << 16) | (g << 8) | b;
  return map.get(intKey) ?? 0;
}

function packLandmarkPattern4bit(pattern) {
  const packedBuffer = Buffer.alloc(PACKED_LANDMARK_PATTERN_BYTES, 0);
  for (let i = 0; i < pattern.length; i++) {
    const paletteIndex = pattern[i];
    if (paletteIndex > 15) {
      throw new Error(
        `Palette index ${paletteIndex} is too large for 4-bit packing. The palette must have 16 or fewer colors.`,
      );
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

async function verifyPNGProperties(filePath) {
  return new Promise((resolve, reject) => {
    exec(`identify -verbose "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        return reject(
          new Error(`identify command failed for ${filePath}: ${stderr}`),
        );
      }
      const formatOk = stdout.includes('Format: PNG');
      const typeOk =
        stdout.includes('Type: Palette') ||
        stdout.includes('Class: PseudoClass') ||
        stdout.includes('Class: DirectClass'); // accept both PseudoClass/indexed and DirectClass
      const depthOk =
        stdout.includes('Depth: 8-bit') ||
        stdout.includes('Depth: 8/4-bit') ||
        stdout.includes('Depth: 4-bit');
      if (formatOk && typeOk && depthOk) {
        resolve(true);
      } else {
        reject(
          new Error(
            `PNG property validation failed for ${filePath}. Got format:${formatOk}, type:${typeOk}, depth:${depthOk}\nIdentify output:\n${stdout}`,
          ),
        );
      }
    });
  });
}

function generateSafeZoneGrid(walkableGrid, width, height, radius) {
  const safeZoneGrid = new Uint8Array(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let isSafe = true;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (walkableGrid[ny * width + nx] !== 0) {
              isSafe = false;
              break;
            }
          }
        }
        if (!isSafe) break;
      }
      if (isSafe) {
        safeZoneGrid[y * width + x] = 1;
      }
    }
  }
  return safeZoneGrid;
}

function generateUniquePatternForId(id, palette) {
  // The landmark packing is 4-bit, so we MUST use palette indices < 16.
  // We exclude 0 (black/noise) and 14 (often another noise/special color).
  const safePaletteIndices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15];
  const N = safePaletteIndices.length;
  const pattern = Buffer.alloc(LANDMARK_SIZE * LANDMARK_SIZE);
  let currentId = id;
  for (let i = 0; i < 25; i++) {
    const digit = currentId % N;
    pattern[i] = safePaletteIndices[digit];
    currentId = Math.floor(currentId / N);
  }
  return pattern;
}

function injectArtificialLandmarks({
  fullMapData,
  safeZoneGrid,
  mapWidth,
  mapHeight,
  indexData,
  palette,
  gridSpacing,
}) {
  const modifiedMapData = new Uint8Array(fullMapData);
  const injectedLandmarks = [];
  let id = 0;
  const halfLandmark = Math.floor(LANDMARK_SIZE / 2);
  for (let y = 0; y < mapHeight; y += gridSpacing) {
    for (let x = 0; x < mapWidth; x += gridSpacing) {
      if (
        x > halfLandmark &&
        x < mapWidth - halfLandmark &&
        y > halfLandmark &&
        y < mapHeight - halfLandmark &&
        safeZoneGrid[y * mapWidth + x] === 1
      ) {
        const pattern = generateUniquePatternForId(id, palette);
        for (let my = 0; my < LANDMARK_SIZE; my++) {
          for (let mx = 0; mx < LANDMARK_SIZE; mx++) {
            const mapX = x - halfLandmark + mx;
            const mapY = y - halfLandmark + my;
            modifiedMapData[mapY * mapWidth + mapX] =
              pattern[my * LANDMARK_SIZE + mx];
          }
        }
        injectedLandmarks.push({
          x: x + indexData.minX,
          y: y + indexData.minY,
          pattern,
        });
        id++;
      }
    }
  }
  return { modifiedMapData, injectedLandmarks };
}

function prepopulateCoverageMap(
  coverageMap,
  landmarks,
  mapWidth,
  mapHeight,
  indexData,
) {
  const halfLandmark = Math.floor(LANDMARK_SIZE / 2);
  const halfMinimapW = Math.floor(MINIMAP_WIDTH / 2);
  const halfMinimapH = Math.floor(MINIMAP_HEIGHT / 2);
  const visibilityRadiusX = halfMinimapW - halfLandmark;
  const visibilityRadiusY = halfMinimapH - halfLandmark;
  for (const landmark of landmarks) {
    const localX = landmark.x - indexData.minX;
    const localY = landmark.y - indexData.minY;
    const playerStartX = Math.max(0, localX - visibilityRadiusX);
    const playerEndX = Math.min(mapWidth, localX + visibilityRadiusX);
    const playerStartY = Math.max(0, localY - visibilityRadiusY);
    const playerEndY = Math.min(mapHeight, localY + visibilityRadiusY);
    for (let playerY = playerStartY; playerY < playerEndY; playerY++) {
      for (let playerX = playerStartX; playerX < playerEndX; playerX++) {
        coverageMap[playerY * mapWidth + playerX]++;
      }
    }
  }
}

/**
 * Writes an indexed (palette) PNG while preserving the PLTE and tRNS chunks from the original file.
 * Accepts original palette images with bit-depths 1,2,4 or 8 and upgrades the IHDR bit-depth to 8
 * so we can write 1 byte per pixel scanlines. Performs remapping from sourcePalette indices to the
 * original PLTE indices using exact match then nearest-color fallback.
 *
 * Throws if original is not palette-indexed (colorType !== 3) or on irrecoverable errors.
 */
async function writeIndexedPreservePalette({
  outputFilePath,
  originalFilePath,
  indexedPixelBuffer, // Buffer length width*height containing palette indices (0..sourcePalette.length-1)
  width,
  height,
  sourcePalette = PALETTE_DATA, // default to your PALETTE_DATA
}) {
  const original = await fs.readFile(originalFilePath).catch(() => null);
  if (!original) {
    throw new Error(`Original PNG not found: ${originalFilePath}`);
  }

  const chunks = pngChunksExtract(original);

  // find first and last IDAT chunk indices
  const firstIdatIdx = chunks.findIndex((c) => c.name === 'IDAT');
  if (firstIdatIdx === -1) {
    throw new Error(`No IDAT chunk found in original PNG: ${originalFilePath}`);
  }
  let lastIdatIdx = firstIdatIdx;
  while (lastIdatIdx + 1 < chunks.length && chunks[lastIdatIdx + 1].name === 'IDAT') {
    lastIdatIdx++;
  }

  // Get IHDR and sanity check
  const ihdrChunk = chunks.find((c) => c.name === 'IHDR');
  if (!ihdrChunk) throw new Error('IHDR missing in original PNG');
  const ihdr = Buffer.from(ihdrChunk.data);
  const widthOrig = ihdr.readUInt32BE(0);
  const heightOrig = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);

  if (widthOrig !== width || heightOrig !== height) {
    throw new Error(
      `Dimension mismatch: original ${widthOrig}x${heightOrig}, expected ${width}x${height}`,
    );
  }

  // Only accept palette-indexed originals (colorType === 3)
  if (colorType !== 3) {
    throw new Error(
      `Original PNG is not palette-indexed (colorType=${colorType}).`,
    );
  }

  // Ensure PLTE exists (we will preserve it verbatim)
  const plteChunk = chunks.find((c) => c.name === 'PLTE');
  if (!plteChunk) {
    throw new Error('Original PNG missing PLTE chunk; cannot preserve palette.');
  }
  const plteBytes = Buffer.from(plteChunk.data);
  const plteCount = Math.floor(plteBytes.length / 3);

  // Build exact-match map: colorInt -> first PLTE index, and an array of PLTE entries
  const plteExactMap = new Map();
  const plteEntries = new Array(plteCount);
  for (let i = 0; i < plteCount; i++) {
    const r = plteBytes[i * 3];
    const g = plteBytes[i * 3 + 1];
    const b = plteBytes[i * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    if (!plteExactMap.has(key)) plteExactMap.set(key, i);
    plteEntries[i] = { r, g, b, idx: i };
  }

  // Precompute mapping from sourcePalette indices -> PLTE index (use exact match first; otherwise nearest-by-RGB)
  const sourceToPlteMap = new Int32Array(sourcePalette.length).fill(-1);
  for (let si = 0; si < sourcePalette.length; si++) {
    const c = sourcePalette[si] || { r: 0, g: 0, b: 0 };
    const key = (c.r << 16) | (c.g << 8) | c.b;
    if (plteExactMap.has(key)) {
      sourceToPlteMap[si] = plteExactMap.get(key);
    } else {
      // nearest PLTE entry (Euclidean distance squared)
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < plteCount; j++) {
        const pe = plteEntries[j];
        const dr = pe.r - c.r;
        const dg = pe.g - c.g;
        const db = pe.b - c.b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = pe.idx;
          if (dist === 0) break;
        }
      }
      sourceToPlteMap[si] = bestIdx;
    }
  }

  // Remap entire indexedPixelBuffer to target PLTE indices using the precomputed map
  const remappedIndexedBuffer = Buffer.alloc(width * height);
  let outOfRangeSeen = false;
  for (let i = 0; i < indexedPixelBuffer.length; i++) {
    const srcIdx = indexedPixelBuffer[i];
    if (srcIdx < 0 || srcIdx >= sourceToPlteMap.length) {
      remappedIndexedBuffer[i] = 0;
      outOfRangeSeen = true;
    } else {
      remappedIndexedBuffer[i] = sourceToPlteMap[srcIdx];
    }
  }

  if (outOfRangeSeen) {
    logger('warn', `writeIndexedPreservePalette: encountered out-of-range source palette index and mapped to 0 for ${outputFilePath}.`);
  }

  // If bitDepth !== 8, patch IHDR to 8 (so we can write 1 byte per pixel)
  let ihdrForOutput = Buffer.from(ihdr);
  if (bitDepth !== 8) {
    ihdrForOutput.writeUInt8(8, 8); // set bit-depth byte to 8
    logger('debug', `Upgrading IHDR bitDepth from ${bitDepth} to 8 for output of ${outputFilePath}`);
  }

  // Build PNG raw image data with filter byte per row (filter 0 - none)
  const stride = 1 + width; // per-row filter byte + indices
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // no filter
    const srcRowStart = y * width;
    remappedIndexedBuffer.copy(raw, rowStart + 1, srcRowStart, srcRowStart + width);
  }

  const compressed = zlib.deflateSync(raw);

  // Build 'before' and 'after', but replace IHDR with our patched IHDR (if changed)
  const before = chunks.slice(0, firstIdatIdx);
  const after = chunks.slice(lastIdatIdx + 1);

  const beforeWithPatchedIHDR = before.map((c) => {
    if (c.name === 'IHDR') {
      return { name: 'IHDR', data: ihdrForOutput };
    }
    return c;
  });

  const newChunks = [
    ...beforeWithPatchedIHDR,
    { name: 'IDAT', data: Uint8Array.from(compressed) },
    ...after,
  ];

  const outputBuffer = Buffer.from(pngChunksEncode(newChunks));
  await fs.writeFile(outputFilePath, outputBuffer);

  logger('info', `Preserved PLTE for ${outputFilePath}. Source palette length=${sourcePalette.length}, PLTE entries=${plteCount}.`);
}

/**
 * Fallback writer: write as RGB PNG using sharp (only used when original is not indexed).
 * This will not preserve PLTE; use only if preservation is impossible.
 */
async function writeRgbPngFallback({ outputFilePath, rgbBuffer, width, height }) {
  await sharp(rgbBuffer, { raw: { width, height, channels: 3 } }).png().toFile(outputFilePath);
  logger('warn', `Wrote RGB fallback PNG for ${outputFilePath} (PLTE not preserved).`);
}

// --- Main preprocessor ---
async function preprocessMinimaps() {
  logger(
    'info',
    '--- Starting ADVANCED Minimap & 1-BIT Pathfinding Pre-processing ---',
  );

  const palette = PALETTE_DATA;
  if (palette.length > 16) {
    logger(
      'error',
      `FATAL: Palette has ${palette.length} colors. 4-bit packing requires 16 or fewer colors.`,
    );
    process.exit(1);
  }
  const colorToIndexMap = new Map();
  palette.forEach((color, index) => {
    const intKey = (color.r << 16) | (color.g << 8) | color.b;
    colorToIndexMap.set(intKey, index);
  });
  const noiseIndices = new Set([0]);

  await fs.mkdir(RESOURCES_OUTPUT_DIR, { recursive: true });
  await fs.mkdir(PNG_ASSETS_DIR, { recursive: true });

  logger(
    'info',
    '--- STAGE 1: Scanning PNGs to determine map boundaries for each Z-level ---',
  );
  const allFiles = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
  const zLevelIndexData = new Map();

  const colorRegex = /Minimap_Color_(\d+)_(\d+)_(\d+)\.png/;
  const waypointRegex = /Minimap_WaypointCost_(\d+)_(\d+)_(\d+)\.png/;

  for (const file of allFiles) {
    const match = file.match(colorRegex) || file.match(waypointRegex);
    if (!match) continue;
    const [_, x, y, z] = match.map(Number);
    if (!zLevelIndexData.has(z)) {
      zLevelIndexData.set(z, {
        z,
        colorTiles: [],
        waypointTiles: [],
        minX: x,
        maxX: x,
        minY: y,
        maxY: y,
      });
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

  const coverageReports = [];

  logger(
    'info',
    '--- STAGE 2: Assembling full maps, generating landmarks, and saving data ---',
  );
  for (const [z, indexData] of zLevelIndexData.entries()) {
    logger('info', `--- Processing Z-Level ${z} ---`);

    const zLevelResourceDir = path.join(RESOURCES_OUTPUT_DIR, `z${z}`);
    await fs.mkdir(zLevelResourceDir, { recursive: true });

    const mapWidth = indexData.maxX - indexData.minX + 256;
    const mapHeight = indexData.maxY - indexData.minY + 256;

    const specialTransitionPixels = new Set();
    const walkableGrid = new Uint8Array(mapWidth * mapHeight).fill(0);

    if (indexData.colorTiles.length > 0) {
      const fullMapData = new Uint8Array(mapWidth * mapHeight).fill(0);

      logger(
        'info',
        `Assembling ${mapWidth}x${mapHeight} color map for Z=${z} from ${indexData.colorTiles.length} PNGs...`,
      );
      for (const tile of indexData.colorTiles) {
        const inputFilePath = path.join(
          TIBIA_MINIMAP_BASE_PATH,
          `Minimap_Color_${tile.x}_${tile.y}_${z}.png`,
        );
        try {
          const { data, info } = await sharp(inputFilePath)
            .raw()
            .toBuffer({ resolveWithObject: true });
          const relX = tile.x - indexData.minX;
          const relY = tile.y - indexData.minY;
          for (let py = 0; py < info.height; py++) {
            for (let px = 0; px < info.width; px++) {
              const tilePixelIndex = (py * info.width + px) * 3;
              const r = data[tilePixelIndex],
                g = data[tilePixelIndex + 1],
                b = data[tilePixelIndex + 2];
              const paletteIndex = getPaletteIndex(r, g, b, colorToIndexMap);
              const mapX = relX + px;
              const mapY = relY + py;
              fullMapData[mapY * mapWidth + mapX] = paletteIndex;
              if (r === 255 && g === 255 && b === 0) {
                specialTransitionPixels.add(`${mapX},${mapY}`);
              }
            }
          }
        } catch (err) {
          logger(
            'warn',
            `Could not process color tile ${inputFilePath}. It might be missing. Error: ${err.message}`,
          );
        }
      }
      logger(
        'info',
        `(Z=${z}) Identified ${specialTransitionPixels.size} special transition pixels.`,
      );

      if (PROCESS_WAYPOINT_MAPS && indexData.waypointTiles.length > 0) {
        logger('info', `(Z=${z}) Assembling walkable grid...`);
        for (const tile of indexData.waypointTiles) {
          const inputFilePath = path.join(
            TIBIA_MINIMAP_BASE_PATH,
            `Minimap_WaypointCost_${tile.x}_${tile.y}_${z}.png`,
          );
          try {
            const { data, info } = await sharp(inputFilePath)
              .raw()
              .toBuffer({ resolveWithObject: true });
            const relX = tile.x - indexData.minX;
            const relY = tile.y - indexData.minY;
            for (let py = 0; py < info.height; py++) {
              for (let px = 0; px < info.width; px++) {
                const tilePixelIndex = (py * info.width + px) * 3;
                const r = data[tilePixelIndex],
                  g = data[tilePixelIndex + 1],
                  b = data[tilePixelIndex + 2];
                const isWaypointObstacle =
                  (r === 255 && g === 255 && b === 0) ||
                  (r === 255 && g === 0 && b === 255) ||
                  (r === 250 && g === 250 && b === 250);
                const mapX = relX + px;
                const mapY = relY + py;
                const isSpecialTransition =
                  specialTransitionPixels.has(`${mapX},${mapY}`);
                if (!isWaypointObstacle && !isSpecialTransition) {
                  walkableGrid[mapY * mapWidth + mapX] = 1;
                }
              }
            }
          } catch (err) {
            logger(
              'warn',
              `Could not process waypoint tile ${inputFilePath}. It might be missing. Error: ${err.message}`,
            );
          }
        }
      }

      let injectedLandmarks = [];
      let modifiedFullMapData = fullMapData;

      if (ENABLE_HYBRID_LANDMARK_SYSTEM && walkableGrid.length > 0) {
        logger('info', `(Z=${z}) Starting Hybrid System: Generating safe zones...`);
        const safeZoneGrid = generateSafeZoneGrid(
          walkableGrid,
          mapWidth,
          mapHeight,
          SAFE_ZONE_RADIUS,
        );

        logger('info', `(Z=${z}) Injecting artificial landmarks...`);
        const injectionResult = injectArtificialLandmarks({
          fullMapData: modifiedFullMapData,
          safeZoneGrid,
          mapWidth,
          mapHeight,
          indexData,
          palette,
          gridSpacing: ARTIFICIAL_LANDMARK_GRID_SPACING,
        });
        modifiedFullMapData = injectionResult.modifiedMapData;
        injectedLandmarks = injectionResult.injectedLandmarks;
        logger(
          'info',
          `(Z=${z}) Injected ${injectedLandmarks.length} permanent landmarks.`,
        );

        if (injectedLandmarks.length > 0) {
          logger(
            'info',
            `(Z=${z}) Writing back modified map data to source PNGs...`,
          );
          for (const tile of indexData.colorTiles) {
            const outputFilePath = path.join(
              TIBIA_MINIMAP_BASE_PATH,
              `Minimap_Color_${tile.x}_${tile.y}_${z}.png`,
            );
            try {
              const relX = tile.x - indexData.minX;
              const relY = tile.y - indexData.minY;

              // Build indexed buffer (single byte per pixel, palette indices into PALETTE_DATA)
              const tileIndexedBuffer = Buffer.alloc(256 * 256);
              for (let py = 0; py < 256; py++) {
                for (let px = 0; px < 256; px++) {
                  const mapX = relX + px;
                  const mapY = relY + py;
                  const paletteIndex = modifiedFullMapData[mapY * mapWidth + mapX];
                  tileIndexedBuffer[py * 256 + px] = paletteIndex;
                }
              }

              // Try to preserve PLTE/tRNS by writing an indexed PNG (with remapping to original PLTE)
              try {
                await writeIndexedPreservePalette({
                  outputFilePath,
                  originalFilePath: outputFilePath,
                  indexedPixelBuffer: tileIndexedBuffer,
                  width: 256,
                  height: 256,
                  sourcePalette: palette,
                });
                await verifyPNGProperties(outputFilePath);
              } catch (innerErr) {
                // Fallback: original wasn't palette-based or another issue; write RGB PNG instead
                logger(
                  'warn',
                  `Could not preserve palette for ${outputFilePath}: ${innerErr.message}. Falling back to RGB PNG write (will not preserve PLTE).`,
                );

                // Build RGB from palette so fallback image visually matches
                const tileRgbBuffer = Buffer.alloc(256 * 256 * 3);
                for (let py = 0; py < 256; py++) {
                  for (let px = 0; px < 256; px++) {
                    const mapX = relX + px;
                    const mapY = relY + py;
                    const paletteIndex =
                      modifiedFullMapData[mapY * mapWidth + mapX];
                    const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 };
                    const bufferIndex = (py * 256 + px) * 3;
                    tileRgbBuffer[bufferIndex] = color.r;
                    tileRgbBuffer[bufferIndex + 1] = color.g;
                    tileRgbBuffer[bufferIndex + 2] = color.b;
                  }
                }
                await writeRgbPngFallback({
                  outputFilePath,
                  rgbBuffer: tileRgbBuffer,
                  width: 256,
                  height: 256,
                });
                await verifyPNGProperties(outputFilePath);
              }
            } catch (err) {
              logger(
                'error',
                `FATAL: Failed to write back or verify tile ${outputFilePath}. Halting. Error: ${err.message}`,
              );
              process.exit(1);
            }
          }
          logger('info', `(Z=${z}) Successfully wrote back all modified tiles.`);
        }
      }

      let currentFinalLandmarks = [...injectedLandmarks];
      let currentCoverageCountMap = new Uint8Array(mapWidth * mapHeight).fill(0);
      let currentCoverableAreaMask = new Uint8Array(mapWidth * mapHeight).fill(0);

      if (ENABLE_HYBRID_LANDMARK_SYSTEM && injectedLandmarks.length > 0) {
        logger(
          'info',
          `(Z=${z}) Pre-populating coverage map with artificial landmarks...`,
        );
        prepopulateCoverageMap(
          currentCoverageCountMap,
          injectedLandmarks,
          mapWidth,
          mapHeight,
          indexData,
        );
      }

      logger('info', `(Z=${z}) Starting discovery pass 1 (Natural Landmarks)...`);
      ({
        finalLandmarks: currentFinalLandmarks,
        coverageCountMap: currentCoverageCountMap,
        coverableAreaMask: currentCoverableAreaMask,
      } = await generateLandmarks(
        modifiedFullMapData,
        mapWidth,
        mapHeight,
        indexData,
        z,
        2,
        currentFinalLandmarks,
        currentCoverageCountMap,
        currentCoverableAreaMask,
      ));

      logger('info', `(Z=${z}) Starting discovery pass 2 (Natural Landmarks)...`);
      ({
        finalLandmarks: currentFinalLandmarks,
        coverageCountMap: currentCoverageCountMap,
        coverableAreaMask: currentCoverableAreaMask,
      } = await generateLandmarks(
        modifiedFullMapData,
        mapWidth,
        mapHeight,
        indexData,
        z,
        1,
        currentFinalLandmarks,
        currentCoverageCountMap,
        currentCoverableAreaMask,
      ));

      if (currentFinalLandmarks.length > 0) {
        logger(
          'info',
          `(Z=${z}) Final landmark count: ${currentFinalLandmarks.length}.`,
        );
        const landmarkBuffers = currentFinalLandmarks.map((landmark) => {
          const header = Buffer.alloc(8);
          header.writeUInt32LE(landmark.x, 0);
          header.writeUInt32LE(landmark.y, 4);
          const packedPattern = packLandmarkPattern4bit(landmark.pattern);
          return Buffer.concat([header, packedPattern]);
        });
        const finalBuffer = Buffer.concat(landmarkBuffers);
        await fs.writeFile(
          path.join(zLevelResourceDir, 'landmarks.bin'),
          finalBuffer,
        );
      } else {
        logger('warn', `No landmarks found for Z=${z}.`);
      }

      if (SAVE_DEBUG_FULL_MAP_PNG) {
        logger('info', `Generating debug PNG for Z=${z}...`);
        const rgbBuffer = Buffer.alloc(mapWidth * mapHeight * 3);
        for (let i = 0; i < modifiedFullMapData.length; i++) {
          const paletteIndex = modifiedFullMapData[i];
          const color = palette[paletteIndex] || { r: 0, g: 0, b: 0 };
          rgbBuffer[i * 3] = color.r;
          rgbBuffer[i * 3 + 1] = color.g;
          rgbBuffer[i * 3 + 2] = color.b;
        }
        const debugPngPath = path.join(PNG_ASSETS_DIR, `_map_debug_z${z}.png`);
        await sharp(rgbBuffer, {
          raw: { width: mapWidth, height: mapHeight, channels: 3 },
        })
          .png()
          .toFile(debugPngPath);
        logger('info', `Saved debug PNG to: ${debugPngPath}`);
      }

      if (PROCESS_WAYPOINT_MAPS && indexData.waypointTiles.length > 0) {
        logger(
          'debug',
          `(Z=${z}) Packing and writing walkable.bin and walkable.json...`,
        );
        const packedWalkableBuffer = Buffer.alloc(
          Math.ceil((mapWidth * mapHeight) / 8),
        );
        for (let i = 0; i < walkableGrid.length; i++) {
          if (walkableGrid[i] === 1) {
            const byteIndex = Math.floor(i / 8);
            const bitIndex = i % 8;
            packedWalkableBuffer[byteIndex] |= 1 << bitIndex;
          }
        }
        await fs.writeFile(
          path.join(zLevelResourceDir, 'walkable.bin'),
          packedWalkableBuffer,
        );
        const walkableMeta = {
          minX: indexData.minX,
          minY: indexData.minY,
          width: mapWidth,
          height: mapHeight,
        };
        await fs.writeFile(
          path.join(zLevelResourceDir, 'walkable.json'),
          JSON.stringify(walkableMeta, null, 2),
        );
        if (SAVE_DEBUG_WAYPOINT_MAP_PNG) {
          logger('info', `Generating debug PNG for waypoint map Z=${z}...`);
          const waypointRgbBuffer = Buffer.alloc(mapWidth * mapHeight * 3);
          for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
              const index = y * mapWidth + x;
              const bufferIndex = index * 3;
              if (specialTransitionPixels.has(`${x},${y}`)) {
                waypointRgbBuffer[bufferIndex] = 0;
                waypointRgbBuffer[bufferIndex + 1] = 255;
                waypointRgbBuffer[bufferIndex + 2] = 0;
              } else if (walkableGrid[index] === 1) {
                waypointRgbBuffer[bufferIndex] = 255;
                waypointRgbBuffer[bufferIndex + 1] = 255;
                waypointRgbBuffer[bufferIndex + 2] = 255;
              } else {
                waypointRgbBuffer[bufferIndex] = 0;
                waypointRgbBuffer[bufferIndex + 1] = 0;
                waypointRgbBuffer[bufferIndex + 2] = 0;
              }
            }
          }
          const debugPngPath = path.join(
            PNG_ASSETS_DIR,
            `_waypoint_debug_z${z}.png`,
          );
          await sharp(waypointRgbBuffer, {
            raw: { width: mapWidth, height: mapHeight, channels: 3 },
          })
            .png()
            .toFile(debugPngPath);
          logger('info', `Saved waypoint debug PNG to: ${debugPngPath}`);
        }
      }

      let totalCoverablePixels = 0;
      let pixelsWithSufficientCoverage = 0;
      let totalWalkablePixels = 0;
      let walkablePixelsWithSufficientCoverage = 0;
      for (let i = 0; i < currentCoverableAreaMask.length; i++) {
        if (currentCoverableAreaMask[i] === 1) {
          totalCoverablePixels++;
          if (currentCoverageCountMap[i] >= 1) {
            pixelsWithSufficientCoverage++;
          }
        }
        if (walkableGrid[i] === 1) {
          totalWalkablePixels++;
          if (currentCoverageCountMap[i] >= 1) {
            walkablePixelsWithSufficientCoverage++;
          }
        }
      }
      const overallCoveragePercentage =
        totalCoverablePixels > 0
          ? (pixelsWithSufficientCoverage / totalCoverablePixels) * 100
          : 0;
      const walkableCoveragePercentage =
        totalWalkablePixels > 0
          ? (walkablePixelsWithSufficientCoverage / totalWalkablePixels) * 100
          : 0;
      coverageReports.push({
        z,
        finalLandmarkCount: currentFinalLandmarks.length,
        overallCoverage: overallCoveragePercentage.toFixed(2),
        walkableCoverage: walkableCoveragePercentage.toFixed(2),
      });
    } else {
      logger('warn', `No color map tiles found for Z=${z}. Skipping.`);
    }
  }

  logger('info', '--- Pre-processing complete ---');
  logger('info', '--- FINAL COVERAGE SUMMARY ---');
  coverageReports.sort((a, b) => a.z - b.z);
  for (const report of coverageReports) {
    logger(
      'info',
      `Z-Level: ${report.z} | Landmarks: ${
        report.finalLandmarkCount
      } | Walkable Coverage: ${report.walkableCoverage}% | Overall Coverage: ${
        report.overallCoverage
      }%`,
    );
  }
  logger('info', '----------------------------');
}

async function generateLandmarks(
  fullMapData,
  mapWidth,
  mapHeight,
  indexData,
  z,
  targetCoverage,
  existingLandmarks = [],
  existingCoverageMap = null,
  existingCoverableMask = null,
) {
  logger(
    'info',
    `Scanning map for Z=${z} with target coverage: ${targetCoverage}...`,
  );
  const halfLandmark = Math.floor(LANDMARK_SIZE / 2);
  const patternCounts = new Map();
  const allPatterns = new Map();
  const coverableAreaMask =
    existingCoverableMask || new Uint8Array(mapWidth * mapHeight).fill(0);
  const coverageCountMap =
    existingCoverageMap || new Uint8Array(mapWidth * mapHeight).fill(0);
  const finalLandmarks = [...existingLandmarks];
  const noiseIndices = new Set([0, 14]);

  for (let y = halfLandmark; y < mapHeight - halfLandmark; y++) {
    for (let x = halfLandmark; x < mapWidth - halfLandmark; x++) {
      const pattern = Buffer.alloc(LANDMARK_SIZE * LANDMARK_SIZE);
      let isValid = true;
      for (let my = 0; my < LANDMARK_SIZE; my++) {
        for (let mx = 0; mx < LANDMARK_SIZE; mx++) {
          const px =
            fullMapData[
              (y - halfLandmark + my) * mapWidth + (x - halfLandmark + mx)
            ];
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
  logger(
    'info',
    `(Z=${z}) Found ${uniqueLandmarkCandidates.length} unique landmark candidates.`,
  );
  shuffleArray(uniqueLandmarkCandidates);

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
        if (
          coverableAreaMask[playerY * mapWidth + playerX] === 1 &&
          coverageCountMap[playerY * mapWidth + playerX] < targetCoverage
        ) {
          isNeeded = true;
          break;
        }
      }
      if (isNeeded) break;
    }
    if (isNeeded) {
      finalLandmarks.push({
        x: x + indexData.minX,
        y: y + indexData.minY,
        pattern,
      });
      for (let playerY = playerStartY; playerY < playerEndY; playerY++) {
        for (let playerX = playerStartX; playerX < playerEndX; playerX++) {
          if (coverableAreaMask[playerY * mapWidth + playerX] === 1) {
            coverageCountMap[playerY * mapWidth + playerX]++;
          }
        }
      }
    }
  }

  return { finalLandmarks, coverageCountMap, coverableAreaMask };
}

preprocessMinimaps().catch((err) => {
  logger('error', `Fatal error during pre-processing: ${err.message}`);
  console.error(err.stack);
});
