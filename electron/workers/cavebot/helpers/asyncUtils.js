// /workers/cavebot/helpers/asyncUtils.js

import { getDistance } from '../../../utils/distance.js';
import {
  delay as movementDelay,
  awaitWalkConfirmation as movementAwaitWalkConfirmation,
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
      let currentZ = null;
      if (workerState.sabInterface) {
        try {
          const posResult = workerState.sabInterface.get('playerPos');
          if (posResult && posResult.data) {
            currentZ = posResult.data.z;
          }
        } catch (err) {
          currentZ = workerState.playerMinimapPosition?.z;
        }
      } else {
        currentZ = workerState.playerMinimapPosition?.z;
      }

      if (currentZ !== null && currentZ !== initialZ) {
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
      let finalPos = null;
      if (workerState.sabInterface) {
        try {
          const posResult = workerState.sabInterface.get('playerPos');
          if (posResult && posResult.data) {
            finalPos = posResult.data;
          }
        } catch (err) {
          finalPos = workerState.playerMinimapPosition;
        }
      } else {
        finalPos = workerState.playerMinimapPosition;
      }

      if (finalPos) {
        const zChanged = finalPos.z !== initialPos.z;
        const teleported =
          getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold;

        if (zChanged || teleported) {
          clearInterval(intervalId);
          resolve({ success: true, finalPos });
        }
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
