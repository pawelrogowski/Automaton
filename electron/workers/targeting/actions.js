import keypress from 'keypress-native';
import mouseController from 'mouse-controller';
import { createLogger } from '../../utils/logger.js';

// These constants are specific to the targeting logic.
const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 50;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;
const TARGET_CLICK_DELAY_MS = 400;
const TARGET_CONFIRMATION_TIMEOUT_MS = 1000;
const MELEE_DISTANCE_THRESHOLD = 1.9;

/**
 * Creates a set of targeting action functions that close over the provided worker-specific dependencies.
 * This avoids polluting the worker's global scope and makes dependencies explicit.
 * @param {object} workerContext - An object containing dependencies from the worker.
 * @param {Int32Array} workerContext.playerPosArray - The SharedArrayBuffer for player position.
 * @param {Int32Array} workerContext.pathDataArray - The SharedArrayBuffer for path data.
 * @param {MessagePort} workerContext.parentPort - The parent port for sending messages.
 * @returns {object} An object containing the modularized targeting functions.
 */
export function createTargetingActions(workerContext) {
  const { playerPosArray, pathDataArray, parentPort } = workerContext;
  const logger = createLogger({ info: false, error: true, debug: false });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getDirectionKey = (current, target) => {
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    if (dy < 0) {
      if (dx < 0) return 'q';
      if (dx === 0) return 'w';
      if (dx > 0) return 'e';
    } else if (dy === 0) {
      if (dx < 0) return 'a';
      if (dx > 0) return 'd';
    } else if (dy > 0) {
      if (dx < 0) return 'z';
      if (dx === 0) return 's';
      if (dx > 0) return 'c';
    }
    return null;
  };

  const awaitWalkConfirmation = (
    posCounterBeforeMove,
    pathCounterBeforeMove,
    timeoutMs,
  ) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        reject(
          new Error(`awaitWalkConfirmation timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
      const intervalId = setInterval(() => {
        const posChanged =
          playerPosArray &&
          Atomics.load(playerPosArray, 3) > posCounterBeforeMove;
        const pathChanged =
          pathDataArray &&
          Atomics.load(pathDataArray, 4) > pathCounterBeforeMove;
        if (posChanged || pathChanged) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(true);
        }
      }, CLICK_POLL_INTERVAL_MS);
    });
  };

  const selectBestTargetFromGameWorld = (
    globalState,
    playerMinimapPosition,
  ) => {
    const { creatures, targetingList } = globalState.targeting;
    if (
      !creatures ||
      creatures.length === 0 ||
      !targetingList ||
      targetingList.length === 0
    ) {
      return null;
    }

    const reachableCreatures = creatures.filter((c) => c.isReachable);
    const pathfinderTargetInstanceId =
      globalState.cavebot?.dynamicTarget?.targetInstanceId;

    if (pathfinderTargetInstanceId) {
      const currentPathfinderTarget = reachableCreatures.find(
        (c) => c.instanceId === pathfinderTargetInstanceId,
      );
      if (currentPathfinderTarget) {
        const rule = targetingList.find(
          (r) =>
            r.name.startsWith(currentPathfinderTarget.name) &&
            r.action === 'Attack',
        );
        if (rule) {
          const stickiness = rule.stickiness || 0;
          return {
            ...currentPathfinderTarget,
            rule,
            effectivePriority: rule.priority + stickiness,
          };
        }
      }
    }

    const targetableCreatures = reachableCreatures
      .map((creature) => {
        const rule = targetingList.find(
          (r) =>
            r.name.startsWith(creature.name) &&
            r.action === 'Attack' &&
            (r.healthRange === 'Any' || r.healthRange === creature.healthTag),
        );
        if (!rule) return null;
        return { ...creature, rule, effectivePriority: rule.priority };
      })
      .filter(Boolean);

    if (targetableCreatures.length === 0) {
      return null;
    }

    targetableCreatures.sort((a, b) => {
      if (a.effectivePriority !== b.effectivePriority) {
        return b.effectivePriority - a.effectivePriority;
      }
      if (a.gameCoords && b.gameCoords && playerMinimapPosition) {
        const distA = Math.max(
          Math.abs(a.gameCoords.x - playerMinimapPosition.x),
          Math.abs(a.gameCoords.y - playerMinimapPosition.y),
        );
        const distB = Math.max(
          Math.abs(b.gameCoords.x - playerMinimapPosition.x),
          Math.abs(b.gameCoords.y - playerMinimapPosition.y),
        );
        return distA - distB;
      }
      return a.distance - b.distance;
    });

    return targetableCreatures[0];
  };

  const manageTargetAcquisition = async (
    targetingContext,
    globalState,
    pathfindingTarget,
    currentGameTarget,
  ) => {
    if (!pathfindingTarget) {
      targetingContext.lastClickedBattleListIndex = -1;
      return;
    }

    if (currentGameTarget?.instanceId === pathfindingTarget.instanceId) {
      targetingContext.lastClickedBattleListIndex = -1;
      return;
    }

    const now = Date.now();
    if (now - targetingContext.lastClickTime < TARGET_CLICK_DELAY_MS) {
      return;
    }

    const battleList = globalState.battleList.entries;
    const KEY_PRESS_LIMIT = 3;

    const performActionAndWait = async (action, clickRegion = null) => {
      targetingContext.acquisitionUnlockTime = Date.now() + 400;

      const checkTargetAndAcceptSubstitute = () => {
        const currentTarget = globalState.targeting.target;
        if (!currentTarget) return false;

        // 1. Check for perfect instanceId match
        if (currentTarget.instanceId === pathfindingTarget.instanceId) {
          return true;
        }

        // 2. Check for acceptable substitute (same name and is adjacent)
        const isSameName =
          currentTarget.name &&
          pathfindingTarget.name &&
          currentTarget.name.startsWith(pathfindingTarget.name);
        const isAdjacent = currentTarget.distance < MELEE_DISTANCE_THRESHOLD;

        if (isSameName && isAdjacent) {
          logger(
            'info',
            `[Targeting] Original target not found, but accepted adjacent substitute: ${currentTarget.name}`,
          );
          // Update the main target to this new one to prevent re-targeting next tick.
          targetingContext.pathfindingTarget = {
            ...currentTarget,
            rule: pathfindingTarget.rule, // Keep the original rule for stance, etc.
          };
          return true;
        }
        return false;
      };

      if (action === 'tab') {
        await delay(50); // Delay before keypress
        keypress.sendKey('tab', globalState.global.display);
        await delay(50); // Delay after keypress
      } else if (action === 'grave') {
        await delay(50); // Delay before keypress
        keypress.sendKey('`', globalState.global.display);
        await delay(50); // Delay after keypress
      } else if (action === 'click' && clickRegion) {
        const clickX = clickRegion.x + 5;
        const clickY = clickRegion.y + 2;
        await delay(50); // Delay before mouse click
        mouseController.leftClick(
          parseInt(globalState.global.windowId),
          clickX,
          clickY,
          globalState.global.display,
        );
        await delay(50); // Delay after mouse click
      }
      targetingContext.lastClickTime = Date.now();
      await delay(50);

      const startTime = Date.now();
      while (Date.now() - startTime < TARGET_CONFIRMATION_TIMEOUT_MS) {
        if (checkTargetAndAcceptSubstitute()) return true;
        await delay(CLICK_POLL_INTERVAL_MS);
      }
      return checkTargetAndAcceptSubstitute();
    };

    const currentIndex = battleList.findIndex((e) => e.isTarget);
    let bestKeyPlan = { action: null, presses: Infinity };

    if (currentIndex !== -1) {
      const potentialIndices = battleList
        .map((e, i) => i)
        .filter((i) => pathfindingTarget.name.startsWith(battleList[i].name));
      if (potentialIndices.length > 0) {
        for (const desiredIndex of potentialIndices) {
          const tabs =
            (desiredIndex - currentIndex + battleList.length) %
            battleList.length;
          if (tabs > 0 && tabs < bestKeyPlan.presses) {
            bestKeyPlan = { action: 'tab', presses: tabs };
          }
          const graves =
            (currentIndex - desiredIndex + battleList.length) %
            battleList.length;
          if (graves > 0 && graves < bestKeyPlan.presses) {
            bestKeyPlan = { action: 'grave', presses: graves };
          }
        }
      }
    }

    if (bestKeyPlan.action && bestKeyPlan.presses <= KEY_PRESS_LIMIT) {
      logger(
        'info',
        `[Targeting] Acquisition: Key plan is cheap (${bestKeyPlan.presses} <= ${KEY_PRESS_LIMIT}). Trying one '${bestKeyPlan.action}' press.`,
      );
      const acquired = await performActionAndWait(bestKeyPlan.action);
      if (acquired) {
        // F8 press removed as per new requirement
      }
      return;
    }

    if (currentIndex === -1) {
      logger(
        'info',
        "[Targeting] Acquisition: No current target. Trying one 'tab' press.",
      );
      const acquired = await performActionAndWait('tab');
      if (acquired) {
        // F8 press removed as per new requirement
      }
      return;
    }

    logger(
      'info',
      `[Targeting] Acquisition: Key plan too expensive (cost ${bestKeyPlan.presses}). Falling back to mouse clicks.`,
    );
    const potentialBLTargets = battleList
      .map((entry, index) => ({ ...entry, index }))
      .filter((entry) => pathfindingTarget.name.startsWith(entry.name));

    if (potentialBLTargets.length === 0) {
      logger(
        'warn',
        `[Targeting] Target ${pathfindingTarget.name} not found in battle list.`,
      );
      return;
    }

    let startClickIndex = 0;
    const currentBLTarget = battleList[currentIndex];
    if (
      currentBLTarget &&
      pathfindingTarget.name.startsWith(currentBLTarget.name)
    ) {
      const lastTryIndex = potentialBLTargets.findIndex(
        (t) => t.index === currentIndex,
      );
      if (lastTryIndex !== -1) {
        startClickIndex = (lastTryIndex + 1) % potentialBLTargets.length;
      }
    }

    for (let i = 0; i < potentialBLTargets.length; i++) {
      const targetToClick =
        potentialBLTargets[(startClickIndex + i) % potentialBLTargets.length];
      logger(
        'info',
        `[Targeting] Acquisition: Attempting to click ${targetToClick.name} at index ${targetToClick.index}`,
      );
      const acquired = await performActionAndWait(
        'click',
        targetToClick.region,
      );
      if (acquired) {
        // F8 press removed as per new requirement
        return;
      }
    }

    logger(
      'error',
      `[Targeting] Failed to acquire target ${pathfindingTarget.name} after trying all methods.`,
    );
  };

  const manageMovement = async (
    targetingContext,
    globalState,
    pathfindingTarget,
    path,
    pathfindingStatus,
    playerMinimapPosition,
  ) => {
    if (
      !pathfindingTarget ||
      !pathfindingTarget.isReachable ||
      !pathfindingTarget.gameCoords
    ) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      return;
    }

    // If the target is already adjacent, do not attempt to move.
    if (pathfindingTarget.distance < MELEE_DISTANCE_THRESHOLD) {
      return;
    }

    const dynamicGoal = {
      stance: pathfindingTarget.rule.stance,
      distance: pathfindingTarget.rule.distance,
      targetCreaturePos: pathfindingTarget.gameCoords,
      targetInstanceId: pathfindingTarget.instanceId,
    };
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: dynamicGoal,
    });

    if (
      !targetingContext.lastDispatchedVisitedTile ||
      targetingContext.lastDispatchedVisitedTile.x !==
        playerMinimapPosition.x ||
      targetingContext.lastDispatchedVisitedTile.y !==
        playerMinimapPosition.y ||
      targetingContext.lastDispatchedVisitedTile.z !== playerMinimapPosition.z
    ) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/addVisitedTile',
        payload: playerMinimapPosition,
      });
      targetingContext.lastDispatchedVisitedTile = { ...playerMinimapPosition };
    }

    const now = Date.now();
    if (pathfindingStatus !== 1 || path.length === 0) {
      // PATH_STATUS_PATH_FOUND = 1
      return;
    }

    if (now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS) {
      return;
    }

    if (pathfindingTarget.rule.stance === 'Stand') {
      return;
    }

    if (pathfindingStatus === 1 && path.length > 1) {
      const nextStep = path[1];
      const dirKey = getDirectionKey(playerMinimapPosition, nextStep);
      if (dirKey) {
        const posCounterBeforeMove = Atomics.load(playerPosArray, 3);
        const pathCounterBeforeMove = Atomics.load(pathDataArray, 4);
        const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
        const timeout = isDiagonal
          ? MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS
          : MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS;

        keypress.sendKey(dirKey, globalState.global.display);
        targetingContext.lastMovementTime = now;
        try {
          await awaitWalkConfirmation(
            posCounterBeforeMove,
            pathCounterBeforeMove,
            timeout,
          );
          if (isDiagonal) {
            await delay(MOVE_CONFIRM_GRACE_DIAGONAL_MS);
          }
        } catch (error) {}
      }
    }
  };

  return {
    selectBestTargetFromGameWorld,
    manageTargetAcquisition,
    manageMovement,
  };
}
