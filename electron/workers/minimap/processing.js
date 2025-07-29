import { parentPort } from 'worker_threads';
import { performance } from 'perf_hooks';
import findSequences from 'find-sequences-native';
import { floorLevelIndicators } from '../../constants/index.js';
import {
  MINIMAP_WIDTH,
  MINIMAP_HEIGHT,
  HEADER_SIZE,
  colorToIndexMap,
} from './config.js';

/**
 * Analyzes minimap and floor indicator data to determine player position.
 * @returns {Promise<number|null>} The processing duration in ms if successful, otherwise null.
 */
export async function processMinimapData(
  minimapBuffer,
  floorIndicatorBuffer,
  minimapMatcher,
) {
  const startTime = performance.now();

  try {
    // ... (The logic for finding Z, converting the minimap, etc. is unchanged)
    const floorIndicatorSearchBuffer = Buffer.alloc(
      HEADER_SIZE + floorIndicatorBuffer.length,
    );
    floorIndicatorSearchBuffer.writeUInt32LE(2, 0);
    floorIndicatorSearchBuffer.writeUInt32LE(63, 4);
    floorIndicatorBuffer.copy(floorIndicatorSearchBuffer, HEADER_SIZE);

    const searchResults = await findSequences.findSequencesNativeBatch(
      floorIndicatorSearchBuffer,
      {
        floor: {
          sequences: floorLevelIndicators,
          searchArea: { x: 0, y: 0, width: 2, height: 63 },
          occurrence: 'first',
        },
      },
    );

    const foundFloor = searchResults.floor || {};
    const floorKey = Object.keys(foundFloor).reduce(
      (lowest, key) =>
        foundFloor[key] !== null && foundFloor[key].y < lowest.y
          ? { key, y: foundFloor[key].y }
          : lowest,
      { key: null, y: Infinity },
    ).key;
    const detectedZ = floorKey !== null ? parseInt(floorKey, 10) : null;

    if (detectedZ === null) return null;

    const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);
    for (let i = 0; i < minimapIndexData.length; i++) {
      const p = i * 4;
      const key =
        (minimapBuffer[p + 2] << 16) |
        (minimapBuffer[p + 1] << 8) |
        minimapBuffer[p];
      minimapIndexData[i] = colorToIndexMap.get(key) ?? 0;
    }

    const result = await minimapMatcher.findPosition(
      minimapIndexData,
      MINIMAP_WIDTH,
      MINIMAP_HEIGHT,
      detectedZ,
    );

    if (result?.position) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'gameState/setPlayerMinimapPosition',
        payload: {
          x: result.position.x,
          y: result.position.y,
          z: result.position.z,
        },
      });
      // Return the duration for performance tracking
      return performance.now() - startTime;
    }
  } catch (err) {
    console.error(`[MinimapProcessing] Error: ${err.message}`);
  }

  return null; // Return null if no position was found
}
