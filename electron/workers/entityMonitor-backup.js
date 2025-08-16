import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import findHealthBars from 'find-health-bars-native';
import findSequences from 'find-sequences-native';
import { getGameCoordinatesFromScreen } from '../utils/gameWorldClickTranslator.js';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from './sharedConstants.js';

// --- Worker Configuration & Setup ---
const { sharedData } = workerData;
const SCAN_INTERVAL_MS = 32;

if (!sharedData) {
  throw new Error('[EntityMonitor] Shared data not provided.');
}

const { imageSAB, syncSAB, playerPosSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const playerPosArray = playerPosSAB ? new Int32Array(playerPosSAB) : null;
const sharedBufferView = Buffer.from(imageSAB);

// --- SharedArrayBuffer Indices ---
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;

// --- Constellation Configuration ---
const CONSTELLATION_HORIZONTAL_POINTS = 10;
const CONSTELLATION_VERTICAL_POINTS = 8;
const SEQUENCE_LENGTH = 3;
const SEARCH_WINDOW_SIZE = 24;
const QUORUM_THRESHOLD = 0.8;

// --- State ---
let lastProcessedFrameCounter = -1;
let lastSentEntities = null;
let isShuttingDown = false;
let isScanning = false;
let gameWorld = null;
let tileSize = null;

// --- Motion Detection State ---
let isCalibrated = false;
let goldenConstellation = [];
let lastKnownPositions = [];
let lastPlayerPos = null;
const candidateIndices = [5, 15, 25, 35, 45, 55, 65, 75];
const verifierIndices = Array.from(
  { length: CONSTELLATION_HORIZONTAL_POINTS * CONSTELLATION_VERTICAL_POINTS },
  (_, i) => i,
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calibrateConstellation(width, height) {
  console.log('[EntityMonitor] Calibrating motion detection constellation...');
  goldenConstellation = [];
  lastKnownPositions = [];

  const xStep = gameWorld.width / (CONSTELLATION_HORIZONTAL_POINTS + 1);
  const yStep = gameWorld.height / (CONSTELLATION_VERTICAL_POINTS + 1);

  for (let i = 1; i <= CONSTELLATION_VERTICAL_POINTS; i++) {
    for (let j = 1; j <= CONSTELLATION_HORIZONTAL_POINTS; j++) {
      const screenX = Math.round(gameWorld.x + j * xStep);
      const screenY = Math.round(gameWorld.y + i * yStep);

      if (screenX + SEQUENCE_LENGTH > width || screenY >= height) continue;

      const colors = [];
      for (let k = 0; k < SEQUENCE_LENGTH; k++) {
        const offset = (screenY * width + (screenX + k)) * 4;
        const r = sharedBufferView[offset + 2];
        const g = sharedBufferView[offset + 1];
        const b = sharedBufferView[offset + 0];
        colors.push([r, g, b]);
      }

      goldenConstellation.push({
        id: `point_${goldenConstellation.length}`,
        sequence: colors,
      });
      lastKnownPositions.push({ x: screenX, y: screenY });
    }
  }
  isCalibrated = true;
  console.log(
    `[EntityMonitor] Calibration complete. Acquired ${goldenConstellation.length} reference points.`,
  );
}

async function findGridOffset(width, height) {
  if (!isCalibrated) return { dx: 0, dy: 0 };

  for (const index of candidateIndices) {
    if (index >= goldenConstellation.length) continue;

    const candidate = goldenConstellation[index];
    const lastPos = lastKnownPositions[index];

    const searchTask = {
      findCandidate: {
        sequences: { [candidate.id]: { sequence: candidate.sequence } },
        searchArea: {
          x: Math.max(0, lastPos.x - SEARCH_WINDOW_SIZE / 2),
          y: Math.max(0, lastPos.y - SEARCH_WINDOW_SIZE / 2),
          width: SEARCH_WINDOW_SIZE,
          height: SEARCH_WINDOW_SIZE,
        },
        occurrence: 'first',
      },
    };

    const searchResult = await findSequences.findSequencesNativeBatch(
      sharedBufferView,
      searchTask,
    );

    if (searchResult?.findCandidate?.[candidate.id]) {
      const newPos = searchResult.findCandidate[candidate.id];
      const candidateVector = {
        dx: newPos.x - lastPos.x,
        dy: newPos.y - lastPos.y,
      };

      if (candidateVector.dx === 0 && candidateVector.dy === 0) {
        return candidateVector;
      }

      const verifyTask = {
        verifyQuorum: { pixelChecks: {}, searchArea: gameWorld },
      };
      let verifierCount = 0;
      for (const vIndex of verifierIndices) {
        if (vIndex >= goldenConstellation.length) continue;
        const verifier = goldenConstellation[vIndex];
        const verifierLastPos = lastKnownPositions[vIndex];
        const predictedX = verifierLastPos.x + candidateVector.dx;
        const predictedY = verifierLastPos.y + candidateVector.dy;
        const checkId = `v_${vIndex}`;

        const firstPixelColor = verifier.sequence[0];
        const colorHex = `#${firstPixelColor[0].toString(16).padStart(2, '0')}${firstPixelColor[1].toString(16).padStart(2, '0')}${firstPixelColor[2].toString(16).padStart(2, '0')}`;

        if (!verifyTask.verifyQuorum.pixelChecks[colorHex]) {
          verifyTask.verifyQuorum.pixelChecks[colorHex] = [];
        }
        verifyTask.verifyQuorum.pixelChecks[colorHex].push({
          x: predictedX,
          y: predictedY,
          id: checkId,
        });
        verifierCount++;
      }

      const verifyResult = await findSequences.findSequencesNativeBatch(
        sharedBufferView,
        verifyTask,
      );

      let matches = 0;
      if (verifyResult?.verifyQuorum) {
        matches = Object.keys(verifyResult.verifyQuorum).length;
      }

      if (verifierCount > 0 && matches / verifierCount >= QUORUM_THRESHOLD) {
        for (let i = 0; i < lastKnownPositions.length; i++) {
          lastKnownPositions[i].x += candidateVector.dx;
          lastKnownPositions[i].y += candidateVector.dy;
        }
        return candidateVector;
      }
    }
  }

  return { dx: 0, dy: 0 };
}

function deepCompareEntities(a, b) {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const entityA = a[i];
    const entityB = b[i];

    if (
      entityA.absoluteCoords.x !== entityB.absoluteCoords.x ||
      entityA.absoluteCoords.y !== entityB.absoluteCoords.y ||
      entityA.gameCoords.x !== entityB.gameCoords.x ||
      entityA.gameCoords.y !== entityB.gameCoords.y ||
      entityA.gameCoords.z !== entityB.gameCoords.z
    ) {
      return false;
    }
  }

  return true;
}

async function mainLoop() {
  console.log('[EntityMonitor] Starting main loop...');

  while (!isShuttingDown) {
    const loopStartTime = performance.now();

    try {
      if (isScanning) {
        await delay(32);
        continue;
      }

      if (
        !gameWorld ||
        gameWorld.width <= 0 ||
        gameWorld.height <= 0 ||
        !playerPosArray ||
        !tileSize ||
        !tileSize.height
      ) {
        await delay(SCAN_INTERVAL_MS);
        continue;
      }

      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter > lastProcessedFrameCounter) {
        lastProcessedFrameCounter = newFrameCounter;

        if (Atomics.load(syncArray, IS_RUNNING_INDEX) !== 1) {
          await delay(SCAN_INTERVAL_MS);
          continue;
        }

        const width = Atomics.load(syncArray, WIDTH_INDEX);
        const height = Atomics.load(syncArray, HEIGHT_INDEX);

        if (width > 0 && height > 0) {
          isScanning = true;
          try {
            const playerMinimapPosition = {
              x: Atomics.load(playerPosArray, PLAYER_X_INDEX),
              y: Atomics.load(playerPosArray, PLAYER_Y_INDEX),
              z: Atomics.load(playerPosArray, PLAYER_Z_INDEX),
            };

            const playerMoved =
              !lastPlayerPos ||
              lastPlayerPos.x !== playerMinimapPosition.x ||
              lastPlayerPos.y !== playerMinimapPosition.y ||
              lastPlayerPos.z !== playerMinimapPosition.z;

            if (playerMoved) {
              await delay(100);
              isCalibrated = false;
            }

            if (!isCalibrated) {
              calibrateConstellation(width, height);
              lastPlayerPos = { ...playerMinimapPosition };
            }

            const gridOffset = await findGridOffset(width, height);

            const results = await findHealthBars.findHealthBars(
              sharedBufferView,
              gameWorld,
            );

            let creaturesWithCoords = [];
            if (results && results.length > 0) {
              creaturesWithCoords = results
                .map((r) => {
                  // The physical location of the health bar on screen this frame
                  const screenX = r.x;
                  const screenY = r.y;

                  // The "un-scrolled" logical coordinate to be used for game world translation
                  const correctedX = screenX - gridOffset.dx;
                  const correctedY = screenY - gridOffset.dy;

                  const gameCoords = getGameCoordinatesFromScreen(
                    correctedX,
                    correctedY,
                    playerMinimapPosition,
                    gameWorld,
                    tileSize,
                  );

                  if (!gameCoords) {
                    return null;
                  }

                  // --- Run the perfected static positioning logic on the corrected coordinates ---

                  // **FIX:** Check against the physical `screenY`, not the logical `correctedY`
                  const isOnTopRow =
                    screenY >= gameWorld.y &&
                    screenY < gameWorld.y + tileSize.height;

                  if (isOnTopRow) {
                    const topRowThresholdY =
                      gameWorld.y + tileSize.height * 0.6;
                    // **FIX:** Use the physical `screenY` for this check as well
                    if (screenY < topRowThresholdY) {
                      // Top 60% of top row: NO SHIFT
                    } else {
                      // Bottom 40% of top row: SHIFT
                      gameCoords.y += 1;
                    }
                  } else {
                    // Any other row: SHIFT
                    gameCoords.y += 1;
                  }
                  gameCoords.x = Math.round(gameCoords.x);
                  gameCoords.y = Math.round(gameCoords.y);
                  // --- End of static logic ---

                  gameCoords.z = playerMinimapPosition.z;

                  return {
                    absoluteCoords: { x: screenX, y: screenY }, // Report original screen coords
                    gameCoords: gameCoords, // Use fully corrected game coords
                  };
                })
                .filter(Boolean);

              creaturesWithCoords.sort((a, b) =>
                a.absoluteCoords.x !== b.absoluteCoords.x
                  ? a.absoluteCoords.x - b.absoluteCoords.x
                  : a.absoluteCoords.y - b.absoluteCoords.y,
              );
            }

            if (!deepCompareEntities(creaturesWithCoords, lastSentEntities)) {
              lastSentEntities = creaturesWithCoords;
              parentPort.postMessage({
                type: 'batch-update',
                payload: [
                  {
                    type: 'gameState/setPlayerMinimapPosition',
                    payload: playerMinimapPosition,
                  },
                  {
                    type: 'targeting/setEntities',
                    payload: creaturesWithCoords,
                  },
                ],
              });
            }
          } finally {
            isScanning = false;
          }
        }
      }
    } catch (err) {
      console.error('[EntityMonitor] Error in main loop:', err);
      isScanning = false;
    }

    const loopEndTime = performance.now();
    const elapsedTime = loopEndTime - loopStartTime;
    const delayTime = Math.max(0, SCAN_INTERVAL_MS - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
  console.log('[EntityMonitor] Main loop stopped.');
}

parentPort.on('message', (message) => {
  if (message.type === 'shutdown') {
    isShuttingDown = true;
  } else if (message.type === 'state_diff') {
    if (message.payload.regionCoordinates) {
      gameWorld = message.payload.regionCoordinates.regions?.gameWorld;
      tileSize = message.payload.regionCoordinates.regions?.tileSize;
    }
  } else if (typeof message === 'object' && !message.type && !message.command) {
    if (message.regionCoordinates) {
      gameWorld = message.regionCoordinates.regions?.gameWorld;
      tileSize = message.regionCoordinates.regions?.tileSize;
    }
  }
});

mainLoop().catch((err) => {
  console.error('[EntityMonitor] Fatal error in main loop:', err);
  process.exit(1);
});
