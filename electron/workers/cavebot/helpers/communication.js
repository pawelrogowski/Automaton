// /workers/cavebot/helpers/communication.js

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
  if (workerState.playerPosArray) {
    const newPlayerPosCounter = Atomics.load(
      workerState.playerPosArray,
      PLAYER_POS_UPDATE_COUNTER_INDEX,
    );
    if (newPlayerPosCounter > workerState.lastPlayerPosCounter) {
      workerState.playerMinimapPosition = {
        x: Atomics.load(workerState.playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(workerState.playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(workerState.playerPosArray, PLAYER_Z_INDEX),
      };
      workerState.lastPlayerPosCounter = newPlayerPosCounter;
    }
  }

  if (workerState.pathDataArray) {
    if (workerState.shouldRequestNewPath) {
      workerState.path = [];
      workerState.pathfindingStatus = PATH_STATUS_IDLE;
      workerState.lastPathDataCounter = -1;
      workerState.shouldRequestNewPath = false;
      return;
    }

    let consistentRead = false;
    let attempts = 0;
    do {
      const counterBeforeRead = Atomics.load(
        workerState.pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      if (counterBeforeRead === workerState.lastPathDataCounter) return;

      const tempPathfindingStatus = Atomics.load(
        workerState.pathDataArray,
        PATHFINDING_STATUS_INDEX,
      );
      const tempPathChebyshevDistance = Atomics.load(
        workerState.pathDataArray,
        PATH_CHEBYSHEV_DISTANCE_INDEX,
      );
      const pathLength = Atomics.load(
        workerState.pathDataArray,
        PATH_LENGTH_INDEX,
      );
      const tempPath = [];
      const safePathLength = Math.min(pathLength, MAX_PATH_WAYPOINTS);
      for (let i = 0; i < safePathLength; i++) {
        const offset = PATH_WAYPOINTS_START_INDEX + i * PATH_WAYPOINT_SIZE;
        tempPath.push({
          x: Atomics.load(workerState.pathDataArray, offset + 0),
          y: Atomics.load(workerState.pathDataArray, offset + 1),
          z: Atomics.load(workerState.pathDataArray, offset + 2),
        });
      }

      const counterAfterRead = Atomics.load(
        workerState.pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );

      if (counterBeforeRead === counterAfterRead) {
        consistentRead = true;
        workerState.path = tempPath;
        workerState.pathfindingStatus = tempPathfindingStatus;
        workerState.pathChebyshevDistance = tempPathChebyshevDistance;
        workerState.lastPathDataCounter = counterAfterRead;
      } else {
        attempts++;
      }
    } while (!consistentRead && attempts < config.maxSABReadRetries);
  }
};
