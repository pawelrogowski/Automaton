// minimap/processing.js (Optimized Drop-in Replacement)

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
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
} from '../sharedConstants.js';

// --- FIX: Add state to remember the last written position ---
let lastWrittenPosition = null;
// --- END FIX ---

/**
 * Analyzes minimap and floor indicator data to determine player position.
 * @returns {Promise<number|null>} The processing duration in ms if successful, otherwise null.
 */
export async function processMinimapData(
  minimapBuffer,
  floorIndicatorBuffer,
  minimapMatcher,
  workerData,
) {
  const startTime = performance.now();
  const { playerPosSAB } = workerData;
  const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;

  try {
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
      const newPos = result.position;

      // --- FIX: Check if the position has actually changed before updating ---
      if (
        !lastWrittenPosition ||
        newPos.x !== lastWrittenPosition.x ||
        newPos.y !== lastWrittenPosition.y ||
        newPos.z !== lastWrittenPosition.z
      ) {
        // Update SharedArrayBuffer for player position
        if (playerPosArray) {
          Atomics.store(playerPosArray, PLAYER_X_INDEX, newPos.x);
          Atomics.store(playerPosArray, PLAYER_Y_INDEX, newPos.y);
          Atomics.store(playerPosArray, PLAYER_Z_INDEX, newPos.z);
          Atomics.add(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX, 1);
          Atomics.notify(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX);
        }

        // Update our state
        lastWrittenPosition = newPos;
      }
      // --- END FIX ---

      return performance.now() - startTime;
    }
  } catch (err) {
    console.error(`[MinimapProcessing] Error: ${err.message}`);
  }

  return null;
}
