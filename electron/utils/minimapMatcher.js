// This class is responsible for finding a small, captured minimap image within the full, pre-processed map of an entire game floor.
// On startup, it loads the game's color palette and the pre-processed map index. It then constructs a complete,
// in-memory representation of the map floor, not as colors, but as a giant 2D array of palette indices.
// To do this, it reads each pre-processed `.bin` tile file, unpacks its 4-bit indexed data into an 8-bit array,
// and copies it into the correct position in the main map buffer.
// The `findPosition` method then takes a small, packed minimap sample, unpacks it, and performs a highly-efficient
// search for that sequence of indices within the main map data, skipping known "water" pixels to improve accuracy.

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger({ info: true, error: true, debug: false });

const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
const TARGET_Z_LEVEL = 7; // Currently focusing on ground floor
const WATER_COLOR_RGB = { r: 51, g: 102, b: 153 }; // The RGB value for water pixels we'll ignore

class MinimapMatcher {
  constructor() {
    this.mapData = null; // Will store the UNPACKED (Uint8Array) indices of the entire Z-level
    this.mapIndex = null;
    this.palette = null;
    this.waterColorIndex = -1; // The index of the water color in the palette
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.isLoaded = false;
    this.lastKnownPosition = { x: null, y: null, z: null };
    this.minMatchPercentage = 0.98; // Require a very high match percentage for indexed data
  }

  async loadMapData() {
    if (this.isLoaded) {
      logger('info', 'Minimap data already loaded.');
      return;
    }

    const zLevelDir = path.join(PREPROCESSED_BASE_DIR, `z${TARGET_Z_LEVEL}`);
    const indexFilePath = path.join(zLevelDir, 'index.json');
    const paletteFilePath = path.join(PREPROCESSED_BASE_DIR, 'palette.json');

    try {
      // 1. Load the color palette and find the index for the water color
      logger('info', `Loading palette from: ${paletteFilePath}`);
      const paletteFileContent = await fs.readFile(paletteFilePath, 'utf8');
      this.palette = JSON.parse(paletteFileContent);
      this.waterColorIndex = this.palette.findIndex(
        (c) => c.r === WATER_COLOR_RGB.r && c.g === WATER_COLOR_RGB.g && c.b === WATER_COLOR_RGB.b,
      );
      if (this.waterColorIndex === -1) {
        logger('warn', 'Water color RGB not found in the palette.');
      } else {
        logger('info', `Water color identified at palette index: ${this.waterColorIndex}`);
      }

      // 2. Load the map index
      logger('info', `Loading map index from: ${indexFilePath}`);
      const indexFileContent = await fs.readFile(indexFilePath, 'utf8');
      this.mapIndex = JSON.parse(indexFileContent);
      if (!this.mapIndex?.tiles?.length) throw new Error('Map index is empty or malformed.');

      // 3. Calculate map dimensions and create a single large buffer for UNPACKED indices
      const tileWidth = 256,
        tileHeight = 256;
      this.mapWidth = this.mapIndex.maxX - this.mapIndex.minX + tileWidth;
      this.mapHeight = this.mapIndex.maxY - this.mapIndex.minY + tileHeight;
      this.mapData = new Uint8Array(this.mapWidth * this.mapHeight);
      logger('info', `Calculated map dimensions: ${this.mapWidth}x${this.mapHeight}. Allocated memory for unpacked indices.`);

      // 4. Load each tile, unpack it, and place it in the large buffer
      for (const tile of this.mapIndex.tiles) {
        const tileFilePath = path.join(zLevelDir, tile.file);
        const tileBufferWithHeader = await fs.readFile(tileFilePath);
        const tileWidthFromHeader = tileBufferWithHeader.readUInt32LE(0);
        const tileHeightFromHeader = tileBufferWithHeader.readUInt32LE(4);
        const bitsPerPixel = tileBufferWithHeader.readUInt32LE(8);
        const packedTileData = tileBufferWithHeader.subarray(12);

        if (bitsPerPixel !== 4) {
          logger('warn', `Skipping tile ${tile.file}: Expected 4 bits per pixel, got ${bitsPerPixel}.`);
          continue;
        }

        // Unpack the 4-bit data into an 8-bit array for easy access
        const unpackedTileIndices = new Uint8Array(tileWidthFromHeader * tileHeightFromHeader);
        for (let i = 0; i < packedTileData.length; i++) {
          const byte = packedTileData[i];
          const p1Index = i * 2;
          const p2Index = i * 2 + 1;
          unpackedTileIndices[p1Index] = byte >> 4; // First pixel is in the high 4 bits
          if (p2Index < unpackedTileIndices.length) {
            unpackedTileIndices[p2Index] = byte & 0x0f; // Second pixel is in the low 4 bits
          }
        }

        // Copy the unpacked tile data into the main map buffer
        const relativeX = tile.x - this.mapIndex.minX;
        const relativeY = tile.y - this.mapIndex.minY;
        for (let y = 0; y < tileHeightFromHeader; y++) {
          const sourceStart = y * tileWidthFromHeader;
          const sourceEnd = sourceStart + tileWidthFromHeader;
          const destinationStart = (relativeY + y) * this.mapWidth + relativeX;
          this.mapData.set(unpackedTileIndices.subarray(sourceStart, sourceEnd), destinationStart);
        }
      }

      this.isLoaded = true;
      logger('info', 'All minimap data loaded and unpacked into memory.');
    } catch (error) {
      logger('error', `Failed to load minimap data: ${error.message}`);
      this.isLoaded = false;
    }
  }

  /**
   * Finds the minimap image within the loaded map data by matching palette indices.
   * @param {Buffer} packedMinimapData - The 4-bit PACKED image data of the minimap.
   * @param {number} minimapWidth - The width of the minimap image.
   * @param {number} minimapHeight - The height of the minimap image.
   * @param {{isCancelled: boolean}} cancellationToken - An object to signal cancellation.
   * @returns {{x: number, y: number, z: number, confidence: number}|null} The absolute coordinates if a match is found.
   */
  findPosition(packedMinimapData, minimapWidth, minimapHeight, cancellationToken) {
    if (!this.isLoaded) return null;

    const pixelCount = minimapWidth * minimapHeight;
    const unpackedMinimap = new Uint8Array(pixelCount);
    for (let i = 0; i < packedMinimapData.length; i++) {
      const byte = packedMinimapData[i];
      const p1Index = i * 2;
      const p2Index = i * 2 + 1;
      unpackedMinimap[p1Index] = byte >> 4;
      if (p2Index < unpackedMinimap.length) {
        unpackedMinimap[p2Index] = byte & 0x0f;
      }
    }

    let totalPixelsToMatch = 0;
    for (let i = 0; i < unpackedMinimap.length; i++) {
      if (unpackedMinimap[i] !== this.waterColorIndex) {
        totalPixelsToMatch++;
      }
    }
    const allowedMismatches = Math.floor(totalPixelsToMatch * (1 - this.minMatchPercentage));

    const searchArea = (startX, startY, endX, endY) => {
      let bestMatch = { x: 0, y: 0, mismatches: Infinity };

      for (let y = startY; y <= endY - minimapHeight; y++) {
        // --- MODIFICATION: Check for cancellation once per row ---
        if (cancellationToken.isCancelled) {
          logger('debug', 'Search cancelled by new frame.');
          return null;
        }

        for (let x = startX; x <= endX - minimapWidth; x++) {
          let mismatches = 0;
          for (let my = 0; my < minimapHeight; my++) {
            for (let mx = 0; mx < minimapWidth; mx++) {
              const minimapIndex = unpackedMinimap[my * minimapWidth + mx];
              if (minimapIndex === this.waterColorIndex) continue;

              const mapIndex = this.mapData[(y + my) * this.mapWidth + (x + mx)];
              if (minimapIndex !== mapIndex) {
                mismatches++;
              }
              if (mismatches > allowedMismatches || mismatches >= bestMatch.mismatches) {
                break;
              }
            }
            if (mismatches > allowedMismatches || mismatches >= bestMatch.mismatches) break;
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
    if (this.lastKnownPosition.x !== null) {
      const sx = Math.max(0, this.lastKnownPosition.x - searchRadius);
      const sy = Math.max(0, this.lastKnownPosition.y - searchRadius);
      const ex = Math.min(this.mapWidth, this.lastKnownPosition.x + searchRadius);
      const ey = Math.min(this.mapHeight, this.lastKnownPosition.y + searchRadius);
      foundMatch = searchArea(sx, sy, ex, ey);
    }

    // --- MODIFICATION: Check for cancellation between localized and full search ---
    if (cancellationToken.isCancelled) return null;

    if (!foundMatch) {
      foundMatch = searchArea(0, 0, this.mapWidth, this.mapHeight);
    }

    // --- MODIFICATION: Final check before returning ---
    if (cancellationToken.isCancelled) return null;

    if (foundMatch) {
      const confidence = 1 - foundMatch.mismatches / totalPixelsToMatch;
      this.lastKnownPosition = { x: foundMatch.x, y: foundMatch.y, z: TARGET_Z_LEVEL };
      const absoluteX = foundMatch.x + this.mapIndex.minX + Math.floor(minimapWidth / 2);
      const absoluteY = foundMatch.y + this.mapIndex.minY + Math.floor(minimapHeight / 2);
      return { x: absoluteX, y: absoluteY, z: TARGET_Z_LEVEL, confidence };
    }

    return null;
  }
}

export const minimapMatcher = new MinimapMatcher();
