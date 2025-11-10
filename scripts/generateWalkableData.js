// generateWalkableData.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';

const logger = createLogger({ info: false, error: true, debug: false });

// --- PATH CONFIGURATION ---
const PROJECT_ROOT = process.cwd();
const TIBIA_MINIMAP_BASE_PATH = path.join(
  os.homedir(),
  '.local',
  'share',
  'CipSoft GmbH',
  'Tibia5',
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

async function generateWalkableData() {
  logger('info', '--- Starting Walkable Data Generation ---');

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

  logger('info', '--- STAGE 2: Assembling walkable grid and saving data ---');
  for (const [z, indexData] of zLevelIndexData.entries()) {
    if (indexData.waypointTiles.length === 0) {
      logger('info', `Skipping Z-Level ${z} - No waypoint tiles found.`);
      continue;
    }
    logger('info', `--- Processing Z-Level ${z} ---`);
    const zLevelResourceDir = path.join(RESOURCES_OUTPUT_DIR, `z${z}`);
    await fs.mkdir(zLevelResourceDir, { recursive: true });

    const mapWidth = indexData.maxX - indexData.minX + 256;
    const mapHeight = indexData.maxY - indexData.minY + 256;
    const specialTransitionPixels = new Set();
    const walkableGrid = new Uint8Array(mapWidth * mapHeight).fill(0);

    // First, find special transition pixels from color maps
    if (indexData.colorTiles.length > 0) {
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
              if (r === 255 && g === 255 && b === 0) {
                const mapX = relX + px;
                const mapY = relY + py;
                specialTransitionPixels.add(`${mapX},${mapY}`);
              }
            }
          }
        } catch (err) {
          logger(
            'warn',
            `Could not process color tile ${inputFilePath} for transition pixels. It might be missing. Error: ${err.message}`,
          );
        }
      }
    }

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
            const isSpecialTransition = specialTransitionPixels.has(
              `${mapX},${mapY}`,
            );
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
    const debugPngPath = path.join(PNG_ASSETS_DIR, `_waypoint_debug_z${z}.png`);
    await sharp(waypointRgbBuffer, {
      raw: { width: mapWidth, height: mapHeight, channels: 3 },
    })
      .png()
      .toFile(debugPngPath);
    logger('info', `Saved waypoint debug PNG to: ${debugPngPath}`);

    logger('info', `Finished processing Z-Level ${z}.`);
  }
  logger('info', '--- Walkable data generation complete ---');
}

generateWalkableData().catch((err) => {
  logger(
    'error',
    `Fatal error during walkable data generation: ${err.message}`,
  );
  console.error(err.stack);
});
