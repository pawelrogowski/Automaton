// /workers/cavebot/helpers/asyncUtils.js

import {
  PLAYER_X_INDEX,
  PLAYER_Y_INDEX,
  PLAYER_Z_INDEX,
} from '../../sharedConstants.js';
import { getDistance } from '../../../utils/distance.js';
import { 
  delay as movementDelay, 
  awaitWalkConfirmation as movementAwaitWalkConfirmation 
} from '../../movementUtils/confirmationHelpers.js';

export const delay = movementDelay;
export const awaitWalkConfirmation = movementAwaitWalkConfirmation;

export const awaitStateChange = (
  getState,
  condition,
  timeoutMs,
  pollIntervalMs,
) => {
  return new Promise((resolve) => {
    let intervalId = null;
    const timeoutId = setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      resolve(false);
    }, timeoutMs);

    intervalId = setInterval(() => {
      const globalState = getState();
      if (globalState && condition(globalState)) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, pollIntervalMs);
  });
};

export const awaitZLevelChange = (workerState, config, initialZ, timeoutMs) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const currentZ = Atomics.load(workerState.playerPosArray, PLAYER_Z_INDEX);
      if (currentZ !== initialZ) {
        clearInterval(intervalId);
        resolve(true);
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        resolve(false);
      }
    }, config.stateChangePollIntervalMs);
  });
};

export const awaitStandConfirmation = (
  workerState,
  config,
  initialPos,
  timeoutMs,
) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const intervalId = setInterval(() => {
      const finalPos = {
        x: Atomics.load(workerState.playerPosArray, PLAYER_X_INDEX),
        y: Atomics.load(workerState.playerPosArray, PLAYER_Y_INDEX),
        z: Atomics.load(workerState.playerPosArray, PLAYER_Z_INDEX),
      };

      const zChanged = finalPos.z !== initialPos.z;
      const teleported =
        getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold;

      if (zChanged || teleported) {
        clearInterval(intervalId);
        // A small delay to ensure state propagates
        setTimeout(() => resolve({ success: true, finalPos }), 10);
      }

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        reject(
          new Error(`awaitStandConfirmation timed out after ${timeoutMs}ms`),
        );
      }
    }, config.stateChangePollIntervalMs);
  });
};
