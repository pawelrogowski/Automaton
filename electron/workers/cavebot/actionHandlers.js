// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/actionHandlers.js
//start file
// /workers/cavebot/actionHandlers.js

import { parentPort } from 'worker_threads';
import { keyPress } from '../../keyboardControll/keyPress.js';

// ====================== MODIFICATION START ======================
// Corrected paths to go up two directories to the electron root
import useItemOnCoordinates from '../../mouseControll/useItemOnCoordinates.js';
import getDirectionKey from '../../utils/getDirectionKey.js';
import { getDistance } from '../../utils/distance.js';
// ======================= MODIFICATION END =======================
import { getAbsoluteClickCoordinatesForAction } from './helpers/actionUtils.js';
import {
  delay,
  awaitWalkConfirmation,
  awaitZLevelChange,
  awaitStandConfirmation,
} from './helpers/asyncUtils.js';
import { advanceToNextWaypoint } from './helpers/navigation.js';

const post = (payload) => {
  parentPort.postMessage({
    type: 'inputAction',
    payload,
  });
};

const leftClick = (x, y, { type = 'default' } = {}) => {
  post({
    type,
    action: {
      module: 'mouseController',
      method: 'leftClick',
      args: [x, y],
    },
  });
};

// --- NEW LOGIC START ---
// Helper function to compare two tile objects
const areTilesEqual = (tile1, tile2) => {
  if (!tile1 || !tile2) return false;
  return tile1.x === tile2.x && tile1.y === tile2.y && tile1.z === tile2.z;
};
// --- NEW LOGIC END ---

async function performWalk(
  workerState,
  config,
  targetPos,
  timeout,
  isDiagonal,
) {
  const dirKey = getDirectionKey(workerState.playerMinimapPosition, targetPos);
  if (!dirKey) {
    workerState.logger(
      'warn',
      '[handleWalkAction] Could not determine direction key.',
    );
    return;
  }

  // Set movement lock BEFORE sending keypress
  workerState.isWaitingForMovement = true;
  workerState.movementWaitUntil = Date.now() + timeout;

  keyPress(dirKey, { type: 'movement' });

  try {
    await awaitWalkConfirmation(workerState, config, timeout);
    workerState.isWaitingForMovement = false;
  } catch (error) {
    workerState.isWaitingForMovement = false;
    throw error;
  }
}

export async function handleWalkAction(workerState, config) {
  if (!workerState.path || workerState.path.length < 2) {
    workerState.logger(
      'debug',
      `[handleWalkAction] Aborted: Path is too short (${
        workerState.path?.length || 0
      }).`,
    );
    return;
  }

  const nextStep = workerState.path[1];

  const dirKey = getDirectionKey(workerState.playerMinimapPosition, nextStep);
  if (!dirKey) {
    workerState.logger(
      'warn',
      '[handleWalkAction] Could not determine direction key for next step.',
    );
    return;
  }

  const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
  const timeout = isDiagonal
    ? config.moveConfirmTimeoutDiagonalMs
    : config.moveConfirmTimeoutMs;

  try {
    await performWalk(workerState, config, nextStep, timeout, isDiagonal);
    // --- NEW LOGIC START ---
    // If walk succeeds, reset the failure counter.
    workerState.lastFailedStep = null;
    // --- NEW LOGIC END ---
  } catch (error) {
    // --- MODIFIED LOGIC START ---
    const failedTile = nextStep;

    // Check if this is the first failure for this tile, or a new tile failed.
    if (
      !workerState.lastFailedStep ||
      !areTilesEqual(workerState.lastFailedStep.tile, failedTile)
    ) {
      // This is the first failure for this tile. Record it and retry.
      workerState.logger(
        'warn',
        `[FSM] Walk action failed once for tile {x: ${failedTile.x}, y: ${failedTile.y}, z: ${failedTile.z}}. Retrying...`,
      );
      workerState.lastFailedStep = { tile: failedTile, count: 1 };
    } else {
      // This is the second consecutive failure for the same tile.
      // BUT: Check if we actually succeeded in moving there (late movement confirmation)
      const currentPos = workerState.playerMinimapPosition;
      const playerIsOnFailedTile = areTilesEqual(currentPos, failedTile);

      if (playerIsOnFailedTile) {
        // Success! The movement actually worked, just took longer than timeout
        workerState.logger(
          'info',
          `[FSM] Walk to {x: ${failedTile.x}, y: ${failedTile.y}, z: ${failedTile.z}} succeeded despite timeout. Clearing failure.`,
        );
        workerState.lastFailedStep = null;
      } else {
        // Genuine failure - block the tile
        workerState.logger(
          'error',
          `[FSM] Walk action failed twice for tile {x: ${failedTile.x}, y: ${failedTile.y}, z: ${failedTile.z}}. Temporarily blocking.`,
        );

        // Dispatch the action to add the temporary block.
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/addTemporaryBlockedTile',
          payload: {
            tile: { x: failedTile.x, y: failedTile.y, z: failedTile.z },
            duration: 3000,
          },
        });

        // Reset the failure counter since we've taken corrective action.
        workerState.lastFailedStep = null;
      }
    }
    // --- MODIFIED LOGIC END ---
  }
}

export async function handleStandAction(workerState, config, targetWaypoint) {
  const { waypointSections = {} } = workerState.globalState.cavebot;
  const allWaypoints = Object.values(waypointSections).flatMap(
    (section) => section.waypoints || [],
  );
  const waypointIndex = allWaypoints.findIndex(
    (wpt) => wpt.id === targetWaypoint.id,
  );
  workerState.logger(
    'debug',
    `[handleStandAction] Executing for waypoint index ${waypointIndex + 1}.`,
  );
  const initialPos = { ...workerState.playerMinimapPosition };
  const initialZ = initialPos.z;

  // Check if we're already on the waypoint
  const isOnWaypoint =
    initialPos.x === targetWaypoint.x &&
    initialPos.y === targetWaypoint.y &&
    initialPos.z === targetWaypoint.z;

  if (!isOnWaypoint) {
    // Calculate if we're adjacent (Chebyshev distance <= 1)
    const isAdjacent =
      Math.max(
        Math.abs(initialPos.x - targetWaypoint.x),
        Math.abs(initialPos.y - targetWaypoint.y),
      ) <= 1 && initialPos.z === targetWaypoint.z;

    if (isAdjacent) {
      // We're adjacent, perform a single step to the waypoint
      workerState.logger(
        'debug',
        '[handleStandAction] Adjacent to waypoint. Performing single step to waypoint tile.',
      );
      const dirKey = getDirectionKey(initialPos, targetWaypoint);
      if (!dirKey) {
        workerState.logger(
          'warn',
          '[handleStandAction] Could not determine direction key for adjacent step.',
        );
        return false;
      }

      const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
      const timeout = isDiagonal ? 400 : config.moveConfirmTimeoutMs;

      workerState.logger(
        'debug',
        `[handleStandAction] Using ${isDiagonal ? 'diagonal' : 'cardinal'} move with ${timeout}ms timeout.`,
      );

      keyPress(dirKey, { type: 'movement' });

      // Wait with early exit on position or z-level change
      // Stand tiles (holes, stairs, teleports) are special - you can't stand on them.
      // The game instantly teleports you to another z-level when you walk on them.
      // Z-level changes reset walking cooldowns, so we can move immediately after.
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        await delay(config.stateChangePollIntervalMs || 20);
        
        const currentPos = workerState.playerMinimapPosition;
        if (!currentPos) continue;

        // Check if z-level changed - Stand tile activated, action complete!
        // No cooldown after z-level change, so we can proceed immediately.
        if (currentPos.z !== initialZ) {
          workerState.logger(
            'debug',
            `[handleStandAction] Z-level changed after ${Date.now() - startTime}ms. Stand complete, can move immediately.`,
          );
          return true;
        }

        // Check if position changed (but z-level didn't)
        const positionChanged =
          currentPos.x !== initialPos.x ||
          currentPos.y !== initialPos.y;

        if (positionChanged) {
          workerState.logger(
            'debug',
            `[handleStandAction] Position changed after ${Date.now() - startTime}ms.`,
          );
          break;
        }
      }

      // Check current position after timeout/break
      const currentPos = { ...workerState.playerMinimapPosition };
      
      // Double-check for z-level change
      if (currentPos.z !== initialZ) {
        workerState.logger(
          'debug',
          '[handleStandAction] Z-level changed. Stand complete, can move immediately.',
        );
        return true;
      }

      // Fallback: Check if standing on waypoint coordinates (shouldn't happen with real Stand tiles)
      // Real Stand tiles can't be stood on - they always trigger z-level change.
      // This fallback prevents getting stuck if Stand waypoint is placed on a normal tile.
      const nowOnWaypoint =
        currentPos.x === targetWaypoint.x &&
        currentPos.y === targetWaypoint.y &&
        currentPos.z === targetWaypoint.z;

      if (nowOnWaypoint) {
        workerState.logger(
          'warn',
          '[handleStandAction] On waypoint coords but no z-change. Non-special tile? Skipping to avoid stuck.',
        );
        return true;
      }

      // Failed to reach waypoint
      workerState.logger(
        'warn',
        '[handleStandAction] Failed to reach waypoint tile.',
      );
      return false;
    } else {
      // Not adjacent and not on waypoint - should not happen in normal flow
      workerState.logger(
        'warn',
        '[handleStandAction] Not on waypoint and not adjacent. Aborting action.',
      );
      return false;
    }
  }

  // Now we're standing on the waypoint, perform the Stand action
  const currentPos = { ...workerState.playerMinimapPosition };
  const dirKey = getDirectionKey(currentPos, targetWaypoint);
  if (!dirKey) {
    workerState.logger(
      'warn',
      `[handleStandAction] Could not determine direction for stand action at waypoint index ${
        waypointIndex + 1
      }.`,
    );
    return false;
  }

  keyPress(dirKey, { type: 'movement' });

  try {
    const { finalPos } = await awaitStandConfirmation(
      workerState,
      config,
      currentPos,
      config.defaultAwaitStateChangeTimeoutMs,
    );

    return true;
  } catch (error) {
    workerState.logger(
      'warn',
      `[handleStandAction] Await confirmation failed: ${error.message}`,
    );
    return false;
  }
}

async function handleToolAction(
  workerState,
  config,
  targetCoords,
  hotkey,
  useType,
  clickOffset,
) {
  const { logger, globalState } = workerState;
  logger(
    'debug',
    `[handleToolAction] Executing tool '${useType}' with hotkey '${hotkey}'.`,
  );
  const initialPos = { ...workerState.playerMinimapPosition };
  if (!initialPos) {
    logger('error', `[handleToolAction:${useType}] No initial position found.`);
    return false;
  }

  // Use the standardized animation delay only for shovel
  if (useType === 'shovel') {
    await delay(config.animationArrivalTimeoutMs);
  }

  const clickCoords = getAbsoluteClickCoordinatesForAction(
    globalState,
    targetCoords,
    initialPos,
    clickOffset,
  );

  if (!clickCoords) {
    logger(
      'error',
      `[handleToolAction:${useType}] Could not calculate click coordinates.`,
    );
    return false;
  }

  const windowId = parseInt(globalState.global.windowId, 10);
  const display = globalState.global.display || ':0';

  if (useType === 'ladder') {
    logger(
      'debug',
      `[handleToolAction:ladder] Map click at (${clickCoords.x}, ${clickCoords.y}) targeting {x:${targetCoords.x}, y:${targetCoords.y}, z:${targetCoords.z}}`,
    );
    leftClick(clickCoords.x, clickCoords.y, { type: 'movement' });
  } else if (useType === 'rope') {
    logger(
      'debug',
      `[handleToolAction:rope] Hotkey '${hotkey}' + map click at (${clickCoords.x}, ${clickCoords.y}) targeting {x:${targetCoords.x}, y:${targetCoords.y}, z:${targetCoords.z}}`,
    );
    keyPress(hotkey, { type: 'movement' });
    await delay(50); // Small delay between hotkey and click
    leftClick(clickCoords.x, clickCoords.y, { type: 'movement' });
  } else if (useType === 'shovel') {
    useItemOnCoordinates(clickCoords.x, clickCoords.y, hotkey, {
      type: 'movement',
    });
  }

  const zChanged = await awaitZLevelChange(
    workerState,
    config,
    initialPos.z,
    config.defaultAwaitStateChangeTimeoutMs,
  );

  if (zChanged) {
    logger(
      'debug',
      `[handleToolAction:${useType}] Z-level change confirmed. Action successful.`,
    );
    return true;
  }
  logger(
    'warn',
    `[handleToolAction:${useType}] Failed to confirm Z-level change.`,
  );
  return false;
}

export const handleLadderAction = (workerState, config, targetCoords) =>
  handleToolAction(
    workerState,
    config,
    targetCoords,
    null,
    'ladder',
    'bottomRight',
  );
export const handleRopeAction = (workerState, config, targetCoords) =>
  handleToolAction(
    workerState,
    config,
    targetCoords,
    config.toolHotkeys.rope,
    'rope',
    'bottomRight',
  );
export async function handleShovelAction(workerState, config, targetCoords) {
  const { logger, globalState } = workerState;
  const hotkey = config.toolHotkeys.shovel;
  if (!hotkey) {
    logger('error', '[handleShovelAction] Shovel hotkey not configured.');
    return false;
  }

  const initialPos = { ...workerState.playerMinimapPosition };
  const initialZ = initialPos.z;

  // Check if we're already on the waypoint
  const isOnWaypoint =
    initialPos.x === targetCoords.x &&
    initialPos.y === targetCoords.y &&
    initialPos.z === targetCoords.z;

  if (!isOnWaypoint) {
    // Calculate if we're adjacent (Chebyshev distance <= 1)
    const isAdjacent =
      Math.max(
        Math.abs(initialPos.x - targetCoords.x),
        Math.abs(initialPos.y - targetCoords.y),
      ) <= 1 && initialPos.z === targetCoords.z;

    if (isAdjacent) {
      // We're adjacent, perform a single hardcoded step to the waypoint
      logger(
        'debug',
        '[handleShovelAction] Adjacent to waypoint. Performing single step to waypoint tile.',
      );
      const dirKey = getDirectionKey(initialPos, targetCoords);
      if (!dirKey) {
        logger(
          'warn',
          '[handleShovelAction] Could not determine direction key for adjacent step.',
        );
        return false;
      }

      const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
      const timeout = isDiagonal
        ? config.moveConfirmTimeoutDiagonalMs
        : config.moveConfirmTimeoutMs;

      try {
        await performWalk(
          workerState,
          config,
          targetCoords,
          timeout,
          isDiagonal,
        );

        // Check if we changed Z-level after walking
        const currentZ = workerState.playerMinimapPosition.z;
        if (currentZ !== initialZ) {
          logger(
            'debug',
            '[handleShovelAction] Z-level changed after walking onto tile. Hole was already open.',
          );
          return true;
        }

        logger(
          'debug',
          '[handleShovelAction] Standing on waypoint tile, same Z-level. Will use shovel.',
        );
      } catch (error) {
        logger(
          'warn',
          `[handleShovelAction] Failed to walk onto waypoint tile: ${error.message}.`,
        );
        return false;
      }
    } else {
      // Not adjacent and not on waypoint - this shouldn't happen in normal flow
      logger(
        'warn',
        '[handleShovelAction] Not on waypoint and not adjacent. Skipping action.',
      );
      return false;
    }
  } else {
    logger(
      'debug',
      '[handleShovelAction] Already on waypoint tile. Will use shovel.',
    );
  }

  // Now we're standing on the waypoint, use the shovel
  const currentPos = { ...workerState.playerMinimapPosition };
  const clickCoords = getAbsoluteClickCoordinatesForAction(
    globalState,
    targetCoords,
    currentPos,
    'center',
  );

  if (!clickCoords) {
    logger(
      'error',
      '[handleShovelAction] Could not calculate click coordinates.',
    );
    return false;
  }

  await delay(config.animationArrivalTimeoutMs);

  logger(
    'debug',
    `[handleShovelAction] Using shovel hotkey '${hotkey}' at (${clickCoords.x}, ${clickCoords.y}) targeting {x:${targetCoords.x}, y:${targetCoords.y}, z:${targetCoords.z}}`,
  );
  useItemOnCoordinates(clickCoords.x, clickCoords.y, hotkey, {
    type: 'movement',
  });

  const zChanged = await awaitZLevelChange(
    workerState,
    config,
    currentPos.z,
    config.defaultAwaitStateChangeTimeoutMs,
  );

  if (zChanged) {
    logger(
      'debug',
      '[handleShovelAction] Z-level change confirmed. Action successful.',
    );
    return true;
  }
  logger('warn', '[handleShovelAction] Failed to confirm Z-level change.');
  return false;
}

export async function handleMacheteAction(workerState, config, targetWaypoint) {
  const { logger, globalState } = workerState;
  const { waypointSections = {} } = workerState.globalState.cavebot;
  const allWaypoints = Object.values(waypointSections).flatMap(
    (section) => section.waypoints || [],
  );
  const waypointIndex = allWaypoints.findIndex(
    (wpt) => wpt.id === targetWaypoint.id,
  );
  logger(
    'debug',
    `[handleMacheteAction] Executing for waypoint index ${waypointIndex + 1}.`,
  );
  const hotkey = config.toolHotkeys.machete;
  if (!hotkey) {
    logger('error', '[handleMacheteAction] Machete hotkey not configured.');
    return false;
  }

  const initialPos = { ...workerState.playerMinimapPosition };
  const clickCoords = getAbsoluteClickCoordinatesForAction(
    globalState,
    targetWaypoint,
    initialPos,
    'center',
  );
  if (!clickCoords) {
    logger(
      'error',
      '[handleMacheteAction] Could not calculate click coordinates.',
    );
    return false;
  }

  const windowId = parseInt(globalState.global.windowId, 10);
  const display = globalState.global.display || ':0';

  for (let i = 0; i < config.maxMacheteRetries; i++) {
    try {
      // First, try to just walk
      logger(
        'debug',
        `[handleMacheteAction] Attempt ${i + 1}: Trying to walk first.`,
      );
      await performWalk(
        workerState,
        config,
        targetWaypoint,
        config.moveConfirmTimeoutMs,
        false,
      );
      logger(
        'debug',
        `[handleMacheteAction] Attempt ${
          i + 1
        }: Walk succeeded, no machete needed.`,
      );
      return true; // Walk succeeded, no need for machete
    } catch (error) {
      logger(
        'debug',
        `[handleMacheteAction] Walk failed (attempt ${
          i + 1
        }), trying to use machete.`,
      );
    }

    // Walk failed, use tool
    logger(
      'debug',
      `[handleMacheteAction] Attempt ${i + 1}: Using machete hotkey '${hotkey}' at (${clickCoords.x}, ${clickCoords.y}) targeting {x:${targetWaypoint.x}, y:${targetWaypoint.y}, z:${targetWaypoint.z}}`,
    );
    useItemOnCoordinates(clickCoords.x, clickCoords.y, hotkey, {
      type: 'movement',
    });
    await delay(config.actionFailureRetryDelayMs);

    try {
      // Try to walk again after using the tool
      logger(
        'debug',
        `[handleMacheteAction] Attempt ${i + 1}: Trying to walk after using machete.`,
      );
      await performWalk(
        workerState,
        config,
        targetWaypoint,
        config.moveConfirmTimeoutMs,
        false,
      );
      logger(
        'debug',
        `[handleMacheteAction] Attempt ${i + 1}: Walk after machete succeeded.`,
      );
      return true; // Success after using tool
    } catch (error) {
      logger(
        'debug',
        `[handleMacheteAction] Walk after machete also failed (attempt ${
          i + 1
        }).`,
      );
    }
  }

  logger(
    'warn',
    `[handleMacheteAction] Failed to clear path after ${config.maxMacheteRetries} attempts.`,
  );
  return false;
}

export async function handleDoorAction(workerState, config, targetWaypoint) {
  const { logger, globalState } = workerState;
  const { waypointSections = {} } = workerState.globalState.cavebot;
  const allWaypoints = Object.values(waypointSections).flatMap(
    (section) => section.waypoints || [],
  );
  const waypointIndex = allWaypoints.findIndex(
    (wpt) => wpt.id === targetWaypoint.id,
  );
  logger(
    'debug',
    `[handleDoorAction] Executing for waypoint index ${waypointIndex + 1}.`,
  );

  // First, try to just walk in case door is already open
  try {
    logger('debug', '[handleDoorAction] Trying to walk through first.');
    await performWalk(
      workerState,
      config,
      targetWaypoint,
      config.moveConfirmTimeoutMs,
      false,
    );
    logger('debug', '[handleDoorAction] Walk succeeded, door was open.');
    return true;
  } catch (error) {
    logger(
      'debug',
      '[handleDoorAction] Walk failed, attempting to click door.',
    );
  }

  // Walk failed, so try clicking the door
  const initialPos = { ...workerState.playerMinimapPosition };
  const clickCoords = getAbsoluteClickCoordinatesForAction(
    globalState,
    targetWaypoint,
    initialPos,
    'center',
  );
  if (!clickCoords) {
    logger(
      'error',
      '[handleDoorAction] Could not calculate click coordinates.',
    );
    return false;
  }

  logger(
    'debug',
    `[handleDoorAction] Map click at (${clickCoords.x}, ${clickCoords.y}) targeting door at {x:${targetWaypoint.x}, y:${targetWaypoint.y}, z:${targetWaypoint.z}}`,
  );
  leftClick(clickCoords.x, clickCoords.y, { type: 'movement' });

  try {
    await awaitWalkConfirmation(
      workerState,
      config,
      config.actionStateChangeTimeoutMs,
    );
    logger('debug', '[handleDoorAction] Move confirmed after clicking door.');
    return true;
  } catch (e) {
    logger('warn', '[handleDoorAction] Failed to confirm move after clicking.');
    return false;
  }
}

export async function handleScriptAction(workerState, config, targetWpt) {
  const { luaExecutor, logger } = workerState;
  const { waypointSections = {} } = workerState.globalState.cavebot;
  const allWaypoints = Object.values(waypointSections).flatMap(
    (section) => section.waypoints || [],
  );
  const waypointIndex = allWaypoints.findIndex(
    (wpt) => wpt.id === targetWpt.id,
  );
  logger(
    'debug',
    `[handleScriptAction] Executing for waypoint index ${waypointIndex + 1}.`,
  );

  if (!luaExecutor || !luaExecutor.isInitialized) {
    logger('warn', '[handleScriptAction] Lua executor not ready, delaying...');
    await delay(config.controlHandoverGraceMs);
    return;
  }

  if (workerState.scriptErrorWaypointId !== targetWpt.id) {
    workerState.scriptErrorWaypointId = targetWpt.id;
    workerState.scriptErrorCount = 0;
  }

  const result = await luaExecutor.executeScript(targetWpt.script);

  if (result.success) {
    logger(
      'debug',
      `[handleScriptAction] Script for waypoint index ${
        waypointIndex + 1
      } executed successfully.`,
    );
    workerState.scriptErrorCount = 0;
    if (!result.navigationOccurred) {
      logger(
        'debug',
        '[handleScriptAction] Script did not navigate, advancing waypoint manually.',
      );
      await advanceToNextWaypoint(workerState, config);
    }
  } else {
    workerState.scriptErrorCount++;
    logger(
      'warn',
      `[Cavebot] Script at waypoint index ${waypointIndex + 1} failed. Attempt ${
        workerState.scriptErrorCount
      }/${config.maxScriptRetries}.`,
    );

    if (workerState.scriptErrorCount >= config.maxScriptRetries) {
      const attemptText =
        config.maxScriptRetries === 1
          ? '1 time'
          : `${config.maxScriptRetries} times`;
      logger(
        'error',
        `[Cavebot] Script at waypoint index ${
          waypointIndex + 1
        } failed ${attemptText}. Skipping to next waypoint.`,
      );
      await advanceToNextWaypoint(workerState, config);
    } else {
      await delay(config.scriptErrorDelayMs);
    }
  }
}

//endFile
