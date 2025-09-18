// /workers/cavebot/helpers/communication.js

import { parentPort } from 'worker_threads';
import { findCurrentWaypoint } from './navigation.js';
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
  PATH_START_X_INDEX,
  PATH_START_Y_INDEX,
  PATH_START_Z_INDEX,
  PATH_TARGET_X_INDEX,
  PATH_TARGET_Y_INDEX,
  PATH_TARGET_Z_INDEX,
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
  // Restore original player position reading logic for state consistency
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

    const counterBeforeRead = Atomics.load(
      workerState.pathDataArray,
      PATH_UPDATE_COUNTER_INDEX,
    );
    // The stale path validation MUST run every tick, so we only check the counter
    // to see if we need to read the path array again. The validation against player
    // position happens below, regardless.
    if (counterBeforeRead !== workerState.lastPathDataCounter) {
      // Perform a direct, consistent read of all path data
      const pathStartX = Atomics.load(
        workerState.pathDataArray,
        PATH_START_X_INDEX,
      );
      const pathStartY = Atomics.load(
        workerState.pathDataArray,
        PATH_START_Y_INDEX,
      );
      const pathStartZ = Atomics.load(
        workerState.pathDataArray,
        PATH_START_Z_INDEX,
      );
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
        // Cache the read values
        workerState.cachedPath = tempPath;
        workerState.cachedPathStart = {
          x: pathStartX,
          y: pathStartY,
          z: pathStartZ,
        };
        workerState.cachedPathTarget = {
          x: Atomics.load(workerState.pathDataArray, PATH_TARGET_X_INDEX),
          y: Atomics.load(workerState.pathDataArray, PATH_TARGET_Y_INDEX),
          z: Atomics.load(workerState.pathDataArray, PATH_TARGET_Z_INDEX),
        };
        workerState.cachedPathStatus = tempPathfindingStatus;
        workerState.cachedPathChebyshevDistance = tempPathChebyshevDistance;
        workerState.lastPathDataCounter = counterAfterRead;
      }
    }

    // Always perform stale path validation against the latest cached path data
    if (workerState.cachedPathStart) {
      const currentWaypoint = workerState.globalState.cavebot
        ? findCurrentWaypoint(workerState.globalState)
        : null;

      if (
        !workerState.playerMinimapPosition ||
        !currentWaypoint ||
        // Check 1: Path must start from our current position
        workerState.cachedPathStart.x !== workerState.playerMinimapPosition.x ||
        workerState.cachedPathStart.y !== workerState.playerMinimapPosition.y ||
        workerState.cachedPathStart.z !== workerState.playerMinimapPosition.z
        // Check 2: Path must be for our current target waypoint (REMOVED FOR NOW)
        // workerState.cachedPathTarget.x !== currentWaypoint.x ||
        // workerState.cachedPathTarget.y !== currentWaypoint.y ||
        // workerState.cachedPathTarget.z !== currentWaypoint.z
      ) {
        workerState.path = []; // Invalidate path
        workerState.pathfindingStatus = PATH_STATUS_IDLE;
      } else {
        workerState.path = workerState.cachedPath;
        workerState.pathfindingStatus = workerState.cachedPathStatus;
        workerState.pathChebyshevDistance =
          workerState.cachedPathChebyshevDistance;
      }
    }
  }
};
