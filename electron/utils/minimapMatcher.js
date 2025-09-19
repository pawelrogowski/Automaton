import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import MinimapMatcherNative from 'minimap_matcher-native';

const logger = createLogger({ info: false, error: true, debug: false });

let PREPROCESSED_BASE_DIR = null;

// Allow setting the base directory externally (e.g., from workerData)
export const setMinimapResourcesPath = (basePath) => {
  PREPROCESSED_BASE_DIR = basePath;
};

const getPreprocessedBaseDir = () => {
  if (!PREPROCESSED_BASE_DIR) {
    // Fallback for backward compatibility
    const getResourcesPath = () => {
      if (process.resourcesPath) {
        return process.resourcesPath;
      }
      return process.cwd();
    };
    return path.join(getResourcesPath(), 'resources', 'preprocessed_minimaps');
  }
  return PREPROCESSED_BASE_DIR;
};

const LANDMARK_SIZE = 3;
// The landmark pattern is now packed at 4-bits per pixel.
// The C++ addon will now work with 25-byte keys instead of 49-byte keys.
const LANDMARK_PATTERN_BYTES = Math.ceil((LANDMARK_SIZE * LANDMARK_SIZE) / 2); // 25

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
    try {
      this.nativeMatcher = new MinimapMatcherNative.MinimapMatcher({
        LANDMARK_SIZE,
        LANDMARK_PATTERN_BYTES,
        EXCLUDED_COLORS_RGB,
      });
    } catch (error) {
      logger(
        'error',
        `Failed to load native minimap matcher module: ${error.message}`,
      );
      throw error;
    }

    this.isLoaded = false;
    this.lastKnownPositionByZ = new Map();
  }

  async loadMapData() {
    if (this.isLoaded) return;
    try {
      const baseDir = getPreprocessedBaseDir();
      const paletteFilePath = path.join(baseDir, 'palette.json');
      const palette = JSON.parse(await fs.readFile(paletteFilePath, 'utf8'));

      const artificialLandmarkData = new Map();
      const naturalLandmarkData = new Map();

      const zLevelDirs = (await fs.readdir(baseDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.startsWith('z'))
        .map((d) => parseInt(d.name.substring(1), 10));

      const landmarkEntrySize = 8 + LANDMARK_PATTERN_BYTES;

      const parseLandmarks = (buffer) => {
        const landmarks = [];
        for (let i = 0; i < buffer.length; i += landmarkEntrySize) {
          landmarks.push({
            x: buffer.readUInt32LE(i),
            y: buffer.readUInt32LE(i + 4),
            pattern: buffer.subarray(i + 8, i + landmarkEntrySize),
          });
        }
        return landmarks;
      };

      for (const z of zLevelDirs) {
        const zLevelDir = path.join(baseDir, `z${z}`);

        // Load artificial landmarks
        try {
          const artificialBuffer = await fs.readFile(
            path.join(zLevelDir, 'landmarks_artificial.bin'),
          );
          artificialLandmarkData.set(z, parseLandmarks(artificialBuffer));
        } catch (e) {
          if (e.code !== 'ENOENT') {
            logger('error', `Could not load landmarks_artificial.bin for Z=${z}: ${e.message}`);
          }
          artificialLandmarkData.set(z, []);
        }

        // Load natural landmarks
        try {
          const naturalBuffer = await fs.readFile(
            path.join(zLevelDir, 'landmarks_natural.bin'),
          );
          naturalLandmarkData.set(z, parseLandmarks(naturalBuffer));
        } catch (e) {
          if (e.code !== 'ENOENT') {
            logger('error', `Could not load landmarks_natural.bin for Z=${z}: ${e.message}`);
          }
          naturalLandmarkData.set(z, []);
        }

        if (!artificialLandmarkData.get(z).length && !naturalLandmarkData.get(z).length) {
            logger('warn', `No landmarks found for Z=${z}. Position finding will be unavailable for this floor.`);
        }
      }

      // Sync data to the native module once on load
      this.nativeMatcher.palette = palette;
      this.nativeMatcher.artificialLandmarkData = Object.fromEntries(artificialLandmarkData);
      this.nativeMatcher.naturalLandmarkData = Object.fromEntries(naturalLandmarkData);
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
      throw new Error(
        'MinimapMatcher is not loaded. Call loadMapData() first.',
      );
    }

    const resultPromise = this.nativeMatcher.findPosition(
      unpackedMinimap,
      minimapWidth,
      minimapHeight,
      targetZ,
    );

    resultPromise
      .then((result) => {
        if (result && result.position) {
          this.lastKnownPositionByZ.set(targetZ, {
            x: result.mapViewX,
            y: result.mapViewY,
          });
        }
      })
      .catch((err) => {
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
