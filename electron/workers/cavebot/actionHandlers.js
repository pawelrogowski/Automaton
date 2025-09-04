// /workers/cavebot/actionHandlers.js

import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
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

async function performWalk(
  workerState,
  config,
  targetPos,
  timeout,
  isDiagonal,
) {
  const posCounterBeforeMove = workerState.lastPlayerPosCounter;
  const pathCounterBeforeMove = workerState.lastPathDataCounter;
  const dirKey = getDirectionKey(workerState.playerMinimapPosition, targetPos);
  if (!dirKey) return;

  keypress.sendKey(dirKey, workerState.globalState.global.display);
  await awaitWalkConfirmation(
    workerState,
    config,
    posCounterBeforeMove,
    pathCounterBeforeMove,
    timeout,
  );
  if (isDiagonal) {
    await delay(config.postDiagonalMoveDelayMs);
  }
}

export async function handleWalkAction(workerState, config) {
  if (!workerState.path || workerState.path.length < 2) return;

  const nextStep = workerState.path[1];

  const dirKey = getDirectionKey(workerState.playerMinimapPosition, nextStep);
  if (!dirKey) return;

  const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
  const timeout = isDiagonal
    ? config.moveConfirmTimeoutDiagonalMs
    : config.moveConfirmTimeoutMs;

  await performWalk(workerState, config, nextStep, timeout, isDiagonal);
}

export async function handleStandAction(workerState, config, targetWaypoint) {
  const initialPos = { ...workerState.playerMinimapPosition };
  const dirKey = getDirectionKey(initialPos, targetWaypoint);
  if (!dirKey) return false;

  keypress.sendKey(dirKey, workerState.globalState.global.display);

  try {
    const { finalPos } = await awaitStandConfirmation(
      workerState,
      config,
      initialPos,
      config.defaultAwaitStateChangeTimeoutMs,
    );

    if (finalPos.z !== initialPos.z) {
      workerState.floorChangeGraceUntil =
        Date.now() + config.floorChangeGraceMs;
    }
    if (getDistance(initialPos, finalPos) >= config.teleportDistanceThreshold) {
      // Grace is handled by the caller, this just confirms success
    }
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
  const initialPos = { ...workerState.playerMinimapPosition };
  if (!initialPos) return false;

  // Use the standardized animation delay for these tools
  if (useType === 'shovel' || useType === 'rope') {
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
    mouseController.leftClick(windowId, clickCoords.x, clickCoords.y, display);
  } else if (useType === 'rope') {
    keypress.sendKey(hotkey, display);
    await delay(50); // Small delay between hotkey and click
    mouseController.leftClick(windowId, clickCoords.x, clickCoords.y, display);
  } else if (useType === 'shovel') {
    useItemOnCoordinates(
      windowId,
      display,
      clickCoords.x,
      clickCoords.y,
      hotkey,
    );
  }

  const zChanged = await awaitZLevelChange(
    workerState,
    config,
    initialPos.z,
    config.defaultAwaitStateChangeTimeoutMs,
  );

  if (zChanged) {
    workerState.floorChangeGraceUntil = Date.now() + config.floorChangeGraceMs;
    return true;
  }
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
export const handleShovelAction = (workerState, config, targetCoords) =>
  handleToolAction(
    workerState,
    config,
    targetCoords,
    config.toolHotkeys.shovel,
    'shovel',
    'center',
  );

export async function handleMacheteAction(workerState, config, targetWaypoint) {
  const { logger, globalState } = workerState;
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
      await performWalk(
        workerState,
        config,
        targetWaypoint,
        config.moveConfirmTimeoutMs,
        false,
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
    useItemOnCoordinates(
      windowId,
      display,
      clickCoords.x,
      clickCoords.y,
      hotkey,
    );
    await delay(config.actionFailureRetryDelayMs);

    try {
      // Try to walk again after using the tool
      await performWalk(
        workerState,
        config,
        targetWaypoint,
        config.moveConfirmTimeoutMs,
        false,
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

  // First, try to just walk in case door is already open
  try {
    await performWalk(
      workerState,
      config,
      targetWaypoint,
      config.moveConfirmTimeoutMs,
      false,
    );
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

  const posCounterBeforeMove = workerState.lastPlayerPosCounter;
  const pathCounterBeforeMove = workerState.lastPathDataCounter;

  mouseController.leftClick(
    parseInt(globalState.global.windowId, 10),
    clickCoords.x,
    clickCoords.y,
    globalState.global.display || ':0',
  );

  try {
    await awaitWalkConfirmation(
      workerState,
      config,
      posCounterBeforeMove,
      pathCounterBeforeMove,
      config.actionStateChangeTimeoutMs,
    );
    return true;
  } catch (e) {
    logger('warn', '[handleDoorAction] Failed to confirm move after clicking.');
    return false;
  }
}

export async function handleScriptAction(workerState, config, targetWpt) {
  const { luaExecutor, logger } = workerState;
  if (!luaExecutor || !luaExecutor.isInitialized) {
    await delay(config.controlHandoverGraceMs);
    return;
  }

  if (workerState.scriptErrorWaypointId !== targetWpt.id) {
    workerState.scriptErrorWaypointId = targetWpt.id;
    workerState.scriptErrorCount = 0;
  }

  const result = await luaExecutor.executeScript(targetWpt.script);

  if (result.success) {
    workerState.scriptErrorCount = 0;
    if (!result.navigationOccurred) {
      await advanceToNextWaypoint(workerState, config);
    }
  } else {
    workerState.scriptErrorCount++;
    logger(
      'warn',
      `[Cavebot] Script at waypoint ${targetWpt.id} failed. Attempt ${workerState.scriptErrorCount}/${config.maxScriptRetries}.`,
    );

    if (workerState.scriptErrorCount >= config.maxScriptRetries) {
      const attemptText =
        config.maxScriptRetries === 1
          ? '1 time'
          : `${config.maxScriptRetries} times`;
      logger(
        'error',
        `[Cavebot] Script at waypoint ${targetWpt.id} failed ${attemptText}. Skipping to next waypoint.`,
      );
      await advanceToNextWaypoint(workerState, config);
    } else {
      await delay(config.scriptErrorDelayMs);
    }
  }
}
