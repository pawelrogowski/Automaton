import fs from 'fs';
import path from 'path';
import { PREPROCESSED_BASE_DIR } from './config.js';

/**
 * Reads all preprocessed map data from disk and loads it into the pathfinder instance.
 * @param {object} pathfinderInstance - The native Pathfinder addon instance.
 * @param {function} logger - The logger utility.
 */
export function loadAllMapData(pathfinderInstance, logger) {
  if (pathfinderInstance.isLoaded) return;

  logger('info', 'Loading pathfinding data for all Z-levels...');
  const mapDataForAddon = {};
  try {
    const zLevelDirs = fs
      .readdirSync(PREPROCESSED_BASE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('z'))
      .map((d) => d.name);

    for (const zDir of zLevelDirs) {
      const zLevel = parseInt(zDir.substring(1), 10);
      const zLevelPath = path.join(PREPROCESSED_BASE_DIR, zDir);
      try {
        const metadata = JSON.parse(
          fs.readFileSync(path.join(zLevelPath, 'walkable.json'), 'utf8'),
        );
        const grid = fs.readFileSync(path.join(zLevelPath, 'walkable.bin'));
        mapDataForAddon[zLevel] = { ...metadata, grid };
      } catch (e) {
        if (e.code !== 'ENOENT') {
          logger(
            'warn',
            `Could not load pathfinding data for Z=${zLevel}: ${e.message}`,
          );
        }
      }
    }

    pathfinderInstance.loadMapData(mapDataForAddon);

    if (pathfinderInstance.isLoaded) {
      logger(
        'info',
        'Pathfinding data successfully loaded into native module.',
      );
    } else {
      throw new Error(
        'Failed to load data into native module after reading files.',
      );
    }
  } catch (e) {
    logger('error', `Critical error during map data loading: ${e.message}`);
    throw e; // Re-throw to be caught by the worker's main error handler
  }
}
