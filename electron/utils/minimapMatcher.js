import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { createRequire } from 'module';

const logger = createLogger({ info: true, error: true, debug: false });
const require = createRequire(import.meta.url);

const PREPROCESSED_BASE_DIR = path.join(process.cwd(), 'resources', 'preprocessed_minimaps');
const LANDMARK_SIZE = 7;
const LANDMARK_PATTERN_BYTES = LANDMARK_SIZE * LANDMARK_SIZE;
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
  constructor(nativeModulePath) {
    if (!nativeModulePath) {
      throw new Error('MinimapMatcher: nativeModulePath is required.');
    }
    try {
      const { MinimapMatcher: NativeMinimapMatcher } = require(nativeModulePath);
      this.nativeMatcher = new NativeMinimapMatcher({
        LANDMARK_SIZE,
        LANDMARK_PATTERN_BYTES,
        EXCLUDED_COLORS_RGB,
      });
    } catch (error) {
      logger('error', `Failed to load native minimap matcher module from ${nativeModulePath}: ${error.message}`);
      throw error;
    }

    this.isLoaded = false;
    this.lastKnownPositionByZ = new Map();
  }

  async loadMapData() {
    if (this.isLoaded) return;
    try {
      const paletteFilePath = path.join(PREPROCESSED_BASE_DIR, 'palette.json');
      const palette = JSON.parse(await fs.readFile(paletteFilePath, 'utf8'));

      const landmarkData = new Map();
      const fullMapData = new Map(); // <<<--- ADDED: To hold the new single map.bin data

      const zLevelDirs = (await fs.readdir(PREPROCESSED_BASE_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.startsWith('z'))
        .map((d) => parseInt(d.name.substring(1), 10));

      for (const z of zLevelDirs) {
        const zLevelDir = path.join(PREPROCESSED_BASE_DIR, `z${z}`);
        try {
          // --- Load Landmarks (existing logic) ---
          const landmarkBuffer = await fs.readFile(path.join(zLevelDir, 'landmarks.bin'));
          const landmarks = [];
          const landmarkEntrySize = 8 + LANDMARK_PATTERN_BYTES;
          for (let i = 0; i < landmarkBuffer.length; i += landmarkEntrySize) {
            landmarks.push({
              x: landmarkBuffer.readUInt32LE(i),
              y: landmarkBuffer.readUInt32LE(i + 4),
              pattern: landmarkBuffer.subarray(i + 8, i + landmarkEntrySize),
            });
          }
          landmarkData.set(z, landmarks);
        } catch (e) {
          logger('warn', `No landmarks.bin found for Z=${z}. This floor will use fallback search only.`);
          landmarkData.set(z, []);
        }

        // --- ADDED: Load the single map.bin and its index for fallback search ---
        try {
          const index = JSON.parse(await fs.readFile(path.join(zLevelDir, 'index.json'), 'utf8'));
          const mapBuffer = await fs.readFile(path.join(zLevelDir, index.mapFile));
          fullMapData.set(z, {
            buffer: mapBuffer,
            minX: index.minX,
            minY: index.minY,
          });
        } catch (e) {
          logger('warn', `Could not load map.bin or index.json for Z=${z}. Fallback search will be unavailable.`);
        }
        // --- END OF ADDED BLOCK ---
      }

      // Sync data to the native module once on load
      this.nativeMatcher.palette = palette;
      this.nativeMatcher.landmarkData = Object.fromEntries(landmarkData);
      this.nativeMatcher.fullMapData = Object.fromEntries(fullMapData); // <<<--- ADDED: Pass new map data to native module
      this.nativeMatcher.isLoaded = true;
      this.isLoaded = true;

      logger('info', `All minimap data loaded and synced to native module.`);
    } catch (error) {
      logger('error', `Failed to load minimap data: ${error.message}`);
      this.isLoaded = false;
      this.nativeMatcher.isLoaded = false;
    }
  }

  /**
   * Finds the player position asynchronously.
   * This method returns a promise that resolves with the position or rejects on error/cancellation.
   * It will automatically cancel any previously running search.
   * @param {Buffer} unpackedMinimap - A buffer of 8-bit palette indices.
   * @param {number} minimapWidth
   * @param {number} minimapHeight
   * @param {number} targetZ
   * @returns {Promise<object|null>} A promise that resolves with the result object.
   */
  async findPosition(unpackedMinimap, minimapWidth, minimapHeight, targetZ) {
    if (!this.isLoaded) {
      throw new Error('MinimapMatcher is not loaded. Call loadMapData() first.');
    }

    // The native method now handles its own cancellation and returns a promise
    const resultPromise = this.nativeMatcher.findPosition(unpackedMinimap, minimapWidth, minimapHeight, targetZ);

    resultPromise
      .then((result) => {
        // Update lastKnownPositionByZ from native module if a position was found
        if (result && result.position) {
          this.lastKnownPositionByZ.set(targetZ, { x: result.mapViewX, y: result.mapViewY });
        }
      })
      .catch((err) => {
        // Don't pollute logs with expected cancellations
        if (err.message !== 'Search cancelled') {
          logger('error', `Native findPosition error: ${err.message}`);
        }
      });

    return resultPromise;
  }

  /**
   * Explicitly cancels any ongoing search.
   */
  cancelCurrentSearch() {
    this.nativeMatcher.cancelSearch();
  }
}

export { MinimapMatcher };
