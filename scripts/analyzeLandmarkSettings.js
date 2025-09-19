// analyzeLandmarkSettings.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js';
import { PALETTE_DATA } from '../electron/constants/palette.js';

// --- CONFIGURATION ---
const Z_LEVEL_TO_ANALYZE = 7;
const LANDMARK_SIZE = 3;
const MINIMAP_WIDTH = 106;
const MINIMAP_HEIGHT = 109;
const SAFE_ZONE_RADIUS = 9;

// --- RANGES TO TEST ---
const MIN_DISTANCE_RANGE = [3];
const CANDIDATE_SPACING_RANGE = [1];


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

// --- Helper Functions (Copied from preprocessMinimaps.js) ---
function getPaletteIndex(r, g, b, map) {
  const intKey = (r << 16) | (g << 8) | b;
  return map.get(intKey) ?? 0;
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

function calculateDistanceTransform(grid, width, height) {
  const dist = new Float32Array(width * height).fill(Infinity);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0) {
      dist[i] = 0;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (grid[i] !== 0) {
        let minNeighborDist = Infinity;
        if (y > 0) minNeighborDist = Math.min(minNeighborDist, dist[(y - 1) * width + x] + 1);
        if (x > 0) minNeighborDist = Math.min(minNeighborDist, dist[y * width + x - 1] + 1);
        if (y > 0 && x > 0) minNeighborDist = Math.min(minNeighborDist, dist[(y - 1) * width + x - 1] + 1.414);
        if (y > 0 && x < width - 1) minNeighborDist = Math.min(minNeighborDist, dist[(y - 1) * width + x + 1] + 1.414);
        dist[i] = Math.min(dist[i], minNeighborDist);
      }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (grid[i] !== 0) {
        let minNeighborDist = dist[i];
        if (y < height - 1) minNeighborDist = Math.min(minNeighborDist, dist[(y + 1) * width + x] + 1);
        if (x < width - 1) minNeighborDist = Math.min(minNeighborDist, dist[y * width + x + 1] + 1);
        if (y < height - 1 && x < width - 1) minNeighborDist = Math.min(minNeighborDist, dist[(y + 1) * width + x + 1] + 1.414);
        if (y < height - 1 && x > 0) minNeighborDist = Math.min(minNeighborDist, dist[(y + 1) * width + x - 1] + 1.414);
        dist[i] = minNeighborDist;
      }
    }
  }
  return dist;
}

function injectArtificialLandmarks({
  safeZoneGrid,
  walkableGrid,
  mapWidth,
  mapHeight,
  indexData,
  minDistance,
  candidateSpacing
}) {
  const injectedLandmarks = [];
  const halfLandmark = Math.floor(LANDMARK_SIZE / 2);
  const halfMinimapW = Math.floor(MINIMAP_WIDTH / 2);
  const halfMinimapH = Math.floor(MINIMAP_HEIGHT / 2);
  const visibilityRadiusX = halfMinimapW - halfLandmark;
  const visibilityRadiusY = halfMinimapH - halfLandmark;

  const distanceMap = calculateDistanceTransform(safeZoneGrid, mapWidth, mapHeight);

  const candidates = [];
  for (let y = halfLandmark; y < mapHeight - halfLandmark; y += candidateSpacing) {
    for (let x = halfLandmark; x < mapWidth - halfLandmark; x += candidateSpacing) {
      const i = y * mapWidth + x;
      if (safeZoneGrid[i] === 1) {
        candidates.push({ x, y, dist: distanceMap[i] });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);

  const uncoveredWalkablePixels = new Set();
  for(let i = 0; i < walkableGrid.length; i++) {
    if(walkableGrid[i] === 1) {
      uncoveredWalkablePixels.add(i);
    }
  }
  
  const minSqDist = minDistance * minDistance;
  let remainingCandidates = [...candidates];

  while(uncoveredWalkablePixels.size > 0) {
    let bestCandidate = null;
    let maxNewCoverage = 0;
    let bestCoverageSet = null;
    let bestCandidateIndex = -1;

    for (let i = 0; i < remainingCandidates.length; i++) {
      const cand = remainingCandidates[i];
      let tooClose = false;
      for (const placed of injectedLandmarks) {
        const localPlacedX = placed.x - indexData.minX;
        const localPlacedY = placed.y - indexData.minY;
        const dx = cand.x - localPlacedX;
        const dy = cand.y - localPlacedY;
        if (dx * dx + dy * dy < minSqDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const newCoverage = new Set();
      const playerStartX = Math.max(0, cand.x - visibilityRadiusX);
      const playerEndX = Math.min(mapWidth, cand.x + visibilityRadiusX);
      const playerStartY = Math.max(0, cand.y - visibilityRadiusY);
      const playerEndY = Math.min(mapHeight, cand.y + visibilityRadiusY);
      for (let py = playerStartY; py < playerEndY; py++) {
        for (let px = playerStartX; px < playerEndX; px++) {
          const pixelIndex = py * mapWidth + px;
          if (uncoveredWalkablePixels.has(pixelIndex)) {
            newCoverage.add(pixelIndex);
          }
        }
      }

      if (newCoverage.size > maxNewCoverage) {
        maxNewCoverage = newCoverage.size;
        bestCandidate = cand;
        bestCoverageSet = newCoverage;
        bestCandidateIndex = i;
      }
    }

    if (bestCandidate) {
      injectedLandmarks.push({ x: bestCandidate.x + indexData.minX, y: bestCandidate.y + indexData.minY });
      for (const pixel of bestCoverageSet) {
        uncoveredWalkablePixels.delete(pixel);
      }
      remainingCandidates.splice(bestCandidateIndex, 1);
    } else {
      break; 
    }
  }

  let totalWalkable = 0;
  let coveredWalkable = 0;
  for(let i = 0; i < walkableGrid.length; i++) {
    if(walkableGrid[i] === 1) {
      totalWalkable++;
      if(coveredWalkablePixels[i] === 1) {
        coveredWalkable++;
      }
    }
  }
  
  const coveragePercentage = totalWalkable > 0 ? (coveredWalkable / totalWalkable) * 100 : 0;

  return { landmarkCount: injectedLandmarks.length, coverage: coveragePercentage };
}


async function analyze() {
  logger('info', `--- Starting Landmark Setting Analysis for Z-Level ${Z_LEVEL_TO_ANALYZE} ---`);

  const allFiles = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
  const zLevelIndexData = new Map();
  const colorRegex = /Minimap_Color_(\d+)_(\d+)_(\d+)\.png/;
  const waypointRegex = /Minimap_WaypointCost_(\d+)_(\d+)_(\d+)\.png/;

  for (const file of allFiles) {
    const match = file.match(colorRegex) || file.match(waypointRegex);
    if (!match) continue;
    const [_, x, y, z] = match.map(Number);
    if (z !== Z_LEVEL_TO_ANALYZE) continue;

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

  const indexData = zLevelIndexData.get(Z_LEVEL_TO_ANALYZE);
  if (!indexData) {
    logger('error', `No data found for Z-Level ${Z_LEVEL_TO_ANALYZE}`);
    return;
  }

  const mapWidth = indexData.maxX - indexData.minX + 256;
  const mapHeight = indexData.maxY - indexData.minY + 256;
  const walkableGrid = new Uint8Array(mapWidth * mapHeight).fill(0);

  logger('info', 'Assembling walkable grid...');
  for (const tile of indexData.waypointTiles) {
    const inputFilePath = path.join(
      TIBIA_MINIMAP_BASE_PATH,
      `Minimap_WaypointCost_${tile.x}_${tile.y}_${Z_LEVEL_TO_ANALYZE}.png`,
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
          if (!isWaypointObstacle) {
            walkableGrid[(relY + py) * mapWidth + (relX + px)] = 1;
          }
        }
      }
    } catch (err) {
      logger('warn', `Could not process waypoint tile ${inputFilePath}. Error: ${err.message}`);
    }
  }

  logger('info', 'Generating safe zone grid...');
  const safeZoneGrid = generateSafeZoneGrid(walkableGrid, mapWidth, mapHeight, SAFE_ZONE_RADIUS);

  logger('info', '--- Starting Analysis Loop ---');
  console.log('Distance | Spacing | Landmarks | Coverage (%)');
  console.log('---------------------------------------------');

  for (const minDistance of MIN_DISTANCE_RANGE) {
    for (const candidateSpacing of CANDIDATE_SPACING_RANGE) {
      const result = injectArtificialLandmarks({
        safeZoneGrid,
        walkableGrid,
        mapWidth,
        mapHeight,
        indexData,
        minDistance,
        candidateSpacing
      });
      console.log(
        `${minDistance.toString().padEnd(8)} | ${candidateSpacing.toString().padEnd(7)} | ${result.landmarkCount.toString().padEnd(9)} | ${result.coverage.toFixed(2)}`
      );
    }
  }

  logger('info', '--- Analysis Complete ---');
}

analyze().catch(err => {
  logger('error', `Fatal error during analysis: ${err.message}`);
  console.error(err.stack);
});
