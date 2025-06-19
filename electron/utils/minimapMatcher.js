import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger({ info: true, error: true, debug: false });

const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');

const EXCLUDED_COLORS_RGB = [
  { r: 51, g: 102, b: 153 },
  { r: 0, g: 0, b: 0 },
  { r: 255, g: 255, b: 255 },
  { r: 153, g: 153, b: 153 },
  { r: 0, g: 204, b: 0 },
  { r: 102, g: 102, b: 102 },
  { r: 255, g: 204, b: 153 },
  { r: 153, g: 102, b: 51 },
  { r: 255, g: 102, b: 0 },
];

class MinimapMatcher {
  constructor() {
    this.mapData = new Map();
    this.mapIndex = new Map();
    this.palette = null;
    this.excludedColorIndices = new Set();
    this.isLoaded = false;
    this.lastKnownPositionByZ = new Map();
    this.globalLastRelativePosition = { x: null, y: null };
    this.minMatchPercentage = 1.0;
  }

  // loadMapData is correct and does not need to be changed.
  async loadMapData() {
    if (this.isLoaded) return;
    try {
      const paletteFilePath = path.join(PREPROCESSED_BASE_DIR, 'palette.json');
      this.palette = JSON.parse(await fs.readFile(paletteFilePath, 'utf8'));
      this.excludedColorIndices.clear();
      for (const excludedColor of EXCLUDED_COLORS_RGB) {
        const index = this.palette.findIndex((c) => c.r === excludedColor.r && c.g === excludedColor.g && c.b === excludedColor.b);
        if (index !== -1) this.excludedColorIndices.add(index);
      }
      const zLevelDirs = (await fs.readdir(PREPROCESSED_BASE_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.startsWith('z'))
        .map((d) => parseInt(d.name.substring(1), 10));
      for (const z of zLevelDirs) {
        const zLevelDir = path.join(PREPROCESSED_BASE_DIR, `z${z}`);
        const mapIndexForZ = JSON.parse(await fs.readFile(path.join(zLevelDir, 'index.json'), 'utf8'));
        if (!mapIndexForZ?.tiles?.length) continue;
        this.mapIndex.set(z, mapIndexForZ);
        const mapWidthForZ = mapIndexForZ.maxX - mapIndexForZ.minX + 256;
        const mapHeightForZ = mapIndexForZ.maxY - mapIndexForZ.minY + 256;
        const mapDataForZ = new Uint8Array(mapWidthForZ * mapHeightForZ);
        for (const tile of mapIndexForZ.tiles) {
          const tileBuffer = await fs.readFile(path.join(zLevelDir, tile.file));
          const packed = tileBuffer.subarray(12);
          const tileW = tileBuffer.readUInt32LE(0),
            tileH = tileBuffer.readUInt32LE(4);
          const relX = tile.x - mapIndexForZ.minX,
            relY = tile.y - mapIndexForZ.minY;
          for (let i = 0; i < packed.length; i++) {
            const byte = packed[i];
            const p1Idx = i * 2,
              p2Idx = i * 2 + 1;
            if (p1Idx < tileW * tileH)
              mapDataForZ[(relY + Math.floor(p1Idx / tileW)) * mapWidthForZ + (relX + (p1Idx % tileW))] = byte >> 4;
            if (p2Idx < tileW * tileH)
              mapDataForZ[(relY + Math.floor(p2Idx / tileW)) * mapWidthForZ + (relX + (p2Idx % tileW))] = byte & 0x0f;
          }
        }
        this.mapData.set(z, mapDataForZ);
      }
      this.isLoaded = true;
      logger('info', `All minimap data loaded.`);
    } catch (error) {
      logger('error', `Failed to load minimap data: ${error.message}`);
      this.isLoaded = false;
    }
  }

  findPosition(unpackedMinimap, minimapWidth, minimapHeight, cancellationToken, targetZ) {
    if (!this.isLoaded || targetZ === null) return null;

    const mapDataForZ = this.mapData.get(targetZ);
    const mapIndexForZ = this.mapIndex.get(targetZ);
    if (!mapDataForZ || !mapIndexForZ) return null;

    const mapWidth = mapIndexForZ.maxX - mapIndexForZ.minX + 256;
    const mapHeight = mapIndexForZ.maxY - mapIndexForZ.minY + 256;

    let totalPixelsToMatch = 0;
    for (let i = 0; i < unpackedMinimap.length; i++) {
      if (!this.excludedColorIndices.has(unpackedMinimap[i])) totalPixelsToMatch++;
    }
    if (totalPixelsToMatch < 50) return null;
    const allowedMismatches = Math.floor(totalPixelsToMatch * (1 - this.minMatchPercentage));

    const searchArea = (startX, startY, endX, endY) => {
      let bestMatch = { mismatches: Infinity };
      for (let y = Math.max(0, startY); y <= Math.min(endY, mapHeight) - minimapHeight; y++) {
        if (cancellationToken.isCancelled) return null;
        for (let x = Math.max(0, startX); x <= Math.min(endX, mapWidth) - minimapWidth; x++) {
          if ((x & 63) === 0 && cancellationToken.isCancelled) return null;

          let mismatches = 0;
          for (let my = 0; my < minimapHeight; my++) {
            for (let mx = 0; mx < minimapWidth; mx++) {
              const minimapIndex = unpackedMinimap[my * minimapWidth + mx];
              if (this.excludedColorIndices.has(minimapIndex)) continue;

              const mapIndex = mapDataForZ[(y + my) * mapWidth + (x + mx)];
              if (minimapIndex !== mapIndex) mismatches++;

              if (mismatches > allowedMismatches) break;
            }
            if (mismatches > allowedMismatches) break;
          }

          if (mismatches < bestMatch.mismatches) {
            bestMatch = { x, y, mismatches };
          }
        }
      }
      return bestMatch.mismatches <= allowedMismatches ? bestMatch : null;
    };

    let foundMatch = null;
    const searchRadius = 200;
    const lastPosOnThisZ = this.lastKnownPositionByZ.get(targetZ);

    if (lastPosOnThisZ) {
      foundMatch = searchArea(
        lastPosOnThisZ.x - searchRadius,
        lastPosOnThisZ.y - searchRadius,
        lastPosOnThisZ.x + searchRadius,
        lastPosOnThisZ.y + searchRadius,
      );
    } else if (this.globalLastRelativePosition.x !== null) {
      foundMatch = searchArea(
        this.globalLastRelativePosition.x - searchRadius,
        this.globalLastRelativePosition.y - searchRadius,
        this.globalLastRelativePosition.x + searchRadius,
        this.globalLastRelativePosition.y + searchRadius,
      );
    }

    if (!foundMatch) {
      foundMatch = searchArea(0, 0, mapWidth, mapHeight);
    }

    if (cancellationToken.isCancelled) return null;

    if (foundMatch) {
      // Store the RELATIVE coordinates for the next fast search.
      this.lastKnownPositionByZ.set(targetZ, { x: foundMatch.x, y: foundMatch.y });
      this.globalLastRelativePosition = { x: foundMatch.x, y: foundMatch.y };

      // Calculate and return the ABSOLUTE player position.
      const absoluteX = foundMatch.x + mapIndexForZ.minX + Math.floor(minimapWidth / 2);
      const absoluteY = foundMatch.y + mapIndexForZ.minY + Math.floor(minimapHeight / 2);
      return { x: absoluteX, y: absoluteY, z: targetZ };
    } else {
      this.lastKnownPositionByZ.delete(targetZ);
    }
    return null;
  }
}

export const minimapMatcher = new MinimapMatcher();
