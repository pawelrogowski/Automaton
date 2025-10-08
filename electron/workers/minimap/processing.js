// minimap/processing.js (Updated)

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
import { CONTROL_COMMANDS } from '../sabState/schema.js';

let lastWrittenPosition = null;
let sabInterface = null;

export const setSABInterface = (sab) => {
  sabInterface = sab;
};

// Pre-allocate the buffer for minimap processing to avoid re-allocation on every frame.
const minimapIndexData = new Uint8Array(MINIMAP_WIDTH * MINIMAP_HEIGHT);

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

    for (let i = 0; i < minimapIndexData.length; i++) {
      const p = i * 4;
      // BGRA to RGB integer key
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
      const newPos = {
        ...result.position,
        positionSearchMs: result.performance?.totalTimeMs?.toFixed(2) || 0,
      };

      if (
        !lastWrittenPosition ||
        newPos.x !== lastWrittenPosition.x ||
        newPos.y !== lastWrittenPosition.y ||
        newPos.z !== lastWrittenPosition.z
      ) {
        // Write position to unified SAB (primary source of truth)
        // Workers read position directly from SAB when needed - no broadcast required
        if (sabInterface) {
          sabInterface.set('playerPos', {
            x: newPos.x,
            y: newPos.y,
            z: newPos.z,
          });
        }

        // Redux update for UI (workerManager handles SAB→Redux sync, but this provides immediate feedback)
        parentPort.postMessage({
          type: 'batch-update',
          payload: [
            {
              type: 'gameState/setPlayerMinimapPosition',
              payload: newPos,
            },
            {
              type: 'gameState/setLastMoveTime',
              payload: Date.now(),
            },
          ],
        });

        lastWrittenPosition = newPos;
      }

      return performance.now() - startTime;
    }
  } catch (err) {
    console.error(`[MinimapProcessing] Error: ${err.message}`);
  }

  return null;
}
