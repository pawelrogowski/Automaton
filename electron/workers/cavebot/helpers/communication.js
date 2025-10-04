// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/helpers/communication.js

import { parentPort } from 'worker_threads';
import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_LENGTH_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_WAYPOINTS_START_INDEX,
  PATH_WAYPOINT_SIZE,
  PATH_CHEBYSHEV_DISTANCE_INDEX,
  PATHFINDING_STATUS_INDEX,
  PATH_STATUS_IDLE,
  MAX_PATH_WAYPOINTS,
  PATH_WPT_ID_INDEX,
  PATH_INSTANCE_ID_INDEX,
} from '../../sharedConstants.js';

export const postStoreUpdate = (type, payload) =>
  parentPort.postMessage({ storeUpdate: true, type, payload });

export const postGlobalVarUpdate = (key, value) => {
  parentPort.postMessage({
    type: 'lua_global_update',
    payload: { key, value },
  });
};

export const getFreshState = () =>
  new Promise((res) => {
    const onSnap = (msg) => {
      if (msg.type === 'state_snapshot') {
        parentPort.off('message', onSnap);
        res(msg.payload);
      }
    };
    parentPort.on('message', onSnap);
    parentPort.postMessage({ type: 'request_state_snapshot' });
  });

export const updateSABData = (workerState, config) => {
  // --- Player Position Update ---
  if (workerState.playerPosArray) {
    const newPlayerPosCounter = Atomics.load(
      workerState.playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (newPlayerPosCounter > workerState.lastPlayerPosCounter) {
      const lastPos = workerState.playerMinimapPosition;
      const newPos = {
        x: Atomics.load(workerState.playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(workerState.playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(workerState.playerPosArray, PLAYER_Z_INDEX),
      };

      if (lastPos) {
        const dist = Math.max(Math.abs(newPos.x - lastPos.x), Math.abs(newPos.y - lastPos.y));
        if (newPos.z !== lastPos.z) {
          workerState.logger('info', `[Cavebot] Floor change detected (${lastPos.z} -> ${newPos.z}). Applying grace period.`);
          workerState.floorChangeGraceUntil = Date.now() + config.postTeleportGraceMs;
        } else if (dist >= config.teleportDistanceThreshold) {
          workerState.logger('info', `[Cavebot] Teleport detected (distance: ${dist}). Applying grace period.`);
          workerState.floorChangeGraceUntil = Date.now() + config.postTeleportGraceMs;
        }
      }

      workerState.playerMinimapPosition = newPos;
      workerState.lastPlayerPosCounter = newPlayerPosCounter;
    }
  }

  // --- Path Data Update ---
  if (workerState.pathDataArray) {
    if (workerState.shouldRequestNewPath) {
      workerState.path = [];
      workerState.pathfindingStatus = PATH_STATUS_IDLE;
      workerState.lastPathDataCounter = -1;
      workerState.shouldRequestNewPath = false;
      // CRITICAL FIX: Don't return early, allow reading of new data
      // return; // Removed this return to fix the sync deadlock
    }

    const counterBeforeRead = Atomics.load(
      workerState.pathDataArray,
      PATH_UPDATE_COUNTER_INDEX,
    );

    // CRITICAL FIX: Only skip if we've already processed this exact counter
    // AND we're not in a reset state (lastPathDataCounter !== -1)
    if (counterBeforeRead === workerState.lastPathDataCounter && workerState.lastPathDataCounter !== -1) {
      return; // No new path data to process
    }

    // Perform an atomic read of the entire path data block
    const tempPath = [];
    const pathLength = Atomics.load(
      workerState.pathDataArray,
      PATH_LENGTH_INDEX,
    );
    const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);
    for (let i = 0; i < safePathLength; i++) {
      const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
      tempPath.push({
        x: Atomics.load(workerState.pathDataArray, offset + 0),
        y: Atomics.load(workerState.pathDataArray, offset + 1),
        z: Atomics.load(workerState.pathDataArray, offset + 2),
      });
    }
    const tempPathfindingStatus = Atomics.load(
      workerState.pathDataArray,
      PATHFINDING_STATUS_INDEX,
    );
    const tempPathChebyshevDistance = Atomics.load(
      workerState.pathDataArray,
      PATH_CHEBYSHEV_DISTANCE_INDEX,
    );
    const tempPathWptId = Atomics.load(
      workerState.pathDataArray,
      PATH_WPT_ID_INDEX,
    );
    const tempPathInstanceId = Atomics.load(
      workerState.pathDataArray,
      PATH_INSTANCE_ID_INDEX,
    );

    const counterAfterRead = Atomics.load(
      workerState.pathDataArray,
      PATH_UPDATE_COUNTER_INDEX,
    );

    // If the counter changed during our read, the data is inconsistent. Abort and wait for the next tick.
    if (counterBeforeRead !== counterAfterRead) {
      return;
    }

    // The read was successful and atomic. Update the worker state directly.
    // The problematic isPathStale check is now completely removed.
    workerState.path = tempPath;
    workerState.pathfindingStatus = tempPathfindingStatus;
    workerState.pathChebyshevDistance = tempPathChebyshevDistance;
    workerState.pathWptId = tempPathWptId;
    workerState.pathInstanceId = tempPathInstanceId;
    workerState.lastPathDataCounter = counterAfterRead;
  }
};