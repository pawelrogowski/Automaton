// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/helpers/communication.js

import { parentPort } from 'worker_threads';
import {
  PATH_STATUS_IDLE,
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
  if (!workerState.sabInterface) {
    workerState.logger('error', '[Cavebot] Unified SAB interface not available!');
    return;
  }
  
  try {
    const posResult = workerState.sabInterface.get('playerPos');
    if (posResult && posResult.data) {
      const newPos = posResult.data;
      // Only update if we have valid numeric coordinates (not zero/uninitialized)
      if (typeof newPos.x === 'number' && typeof newPos.y === 'number' && typeof newPos.z === 'number') {
        // Check if position is initialized (not all zeros)
        if (newPos.x !== 0 || newPos.y !== 0 || newPos.z !== 0) {
          workerState.playerMinimapPosition = newPos;
        }
      }
    }
  } catch (err) {
    workerState.logger('error', `[Cavebot] SAB position read failed: ${err.message}`);
  }

  // --- Path Data Update (Cavebot-specific) ---
  try {
    if (workerState.shouldRequestNewPath) {
      workerState.path = [];
      workerState.pathfindingStatus = PATH_STATUS_IDLE;
      workerState.shouldRequestNewPath = false;
    }
    
    // Read from cavebot-specific path array
    const pathDataResult = workerState.sabInterface.get('cavebotPathData');
    if (pathDataResult && pathDataResult.data) {
      const pathData = pathDataResult.data;
      
      // Always update status and IDs, even if no waypoints
      workerState.pathfindingStatus = pathData.status || PATH_STATUS_IDLE;
      workerState.pathChebyshevDistance = pathData.chebyshevDistance || null;
      workerState.pathWptId = pathData.wptId || 0;
      workerState.pathInstanceId = pathData.instanceId || 0;
      
      if (pathData.waypoints && pathData.waypoints.length > 0) {
        // CRITICAL: Validate path is for current position (prevent stale path usage)
        const pathStart = pathData.waypoints[0];
        const currentPos = workerState.playerMinimapPosition;
        
        if (currentPos && pathStart) {
          const isPathStale = 
            pathStart.x !== currentPos.x ||
            pathStart.y !== currentPos.y ||
            pathStart.z !== currentPos.z;
          
          if (isPathStale) {
            workerState.logger(
              'debug',
              `[Cavebot] Rejecting stale path ` +
              `(starts at {x:${pathStart.x}, y:${pathStart.y}, z:${pathStart.z}}, ` +
              `player at {x:${currentPos.x}, y:${currentPos.y}, z:${currentPos.z}})`
            );
            workerState.path = [];
          } else {
            workerState.path = pathData.waypoints;
            workerState.logger('debug', `[Cavebot] Read path from SAB: ${workerState.path.length} waypoints, status: ${workerState.pathfindingStatus}, wptId: ${workerState.pathWptId}`);
          }
        } else {
          workerState.path = pathData.waypoints;
        }
      } else {
        workerState.path = [];
      }
    }
  } catch (err) {
    workerState.logger('error', `[Cavebot] SAB path read failed: ${err.message}`);
  }
};
