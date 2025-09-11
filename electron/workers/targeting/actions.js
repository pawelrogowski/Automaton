
import { createLogger } from '../../utils/logger.js';

// These constants are specific to the targeting logic.
const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;
const TARGET_CLICK_DELAY_MS = 50;
const TARGET_CONFIRMATION_TIMEOUT_MS = 375;
const MELEE_DISTANCE_THRESHOLD = 1.5;

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

  // Helper to post input actions to the main thread for orchestration
  const postInputAction = (type, action) => {
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: type,
        action: action,
      },
    });
  };

  let acquisitionTimes = [];
  let maxAcquisitionTime = 0;
  let avgAcquisitionTime = 0;

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
    const battleList = globalState.battleList.entries; // Get battle list entries

    if (!targetingList || targetingList.length === 0) {
      return null;
    }

    // --- Phase 1: Prioritize creatures detected by creatureMonitor (OCR/Red Box) ---
    const reachableCreatures = creatures.filter((c) => c.isReachable);
    const pathfinderTargetInstanceId =
      globalState.cavebot?.dynamicTarget?.targetInstanceId;

    let targetableCreaturesFromMonitor = [];

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
          targetableCreaturesFromMonitor.push({
            ...currentPathfinderTarget,
            rule,
            effectivePriority: rule.priority + stickiness,
          });
        }
      }
    }

    if (targetableCreaturesFromMonitor.length === 0) {
      targetableCreaturesFromMonitor = reachableCreatures
        .map((creature) => {
          const isInBattleList = battleList.some(entry => creature.name.startsWith(entry.name) || entry.name.startsWith(creature.name));
          if (!isInBattleList) return null; // Skip if not in battle list

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
    }

    if (targetableCreaturesFromMonitor.length > 0) {
      const healthOrder = {
        Critical: 0,
        Low: 1,
        Medium: 2,
        High: 3,
        Full: 4,
      };

      targetableCreaturesFromMonitor.sort((a, b) => {
        // 1. Primary Sort: Priority
        if (a.effectivePriority !== b.effectivePriority) {
          return b.effectivePriority - a.effectivePriority;
        }

        // 2. New Tie-Breaker: Health, if both creatures are in melee range
        const aIsInMelee = a.distance <= MELEE_DISTANCE_THRESHOLD;
        const bIsInMelee = b.distance <= MELEE_DISTANCE_THRESHOLD;

        if (aIsInMelee && bIsInMelee) {
          const healthA = healthOrder[a.healthTag] ?? 5;
          const healthB = healthOrder[b.healthTag] ?? 5;
          if (healthA !== healthB) {
            return healthA - healthB; // Lower health wins
          }
        }

        // --- MODIFIED DISTANCE TIE-BREAKER ---
        // Only consider distance if at least one creature is NOT in melee range.
        // If both are in melee range, distance is irrelevant for sorting.
        if (!aIsInMelee || !bIsInMelee) {
          if (a.gameCoords && b.gameCoords && playerMinimapPosition) {
            const distA = Math.max(
              Math.abs(a.gameCoords.x - playerMinimapPosition.x),
              Math.abs(a.gameCoords.y - playerMinimapPosition.y),
            );
            const distB = Math.max(
              Math.abs(b.gameCoords.x - playerMinimapPosition.x),
              Math.abs(b.gameCoords.y - playerMinimapPosition.y),
            );
            if (distA !== distB) {
              return distA - distB;
            }
          } else if (a.distance !== b.distance) {
            return a.distance - b.distance;
          }
        }
        // --- END MODIFIED DISTANCE TIE-BREAKER ---

        // 4. Ultimate Tie-Breaker: Instance ID (stable sort)
        // This ensures a consistent order when all other criteria are identical.
        return a.instanceId - b.instanceId;
      });
      return targetableCreaturesFromMonitor[0];
    }

    // --- Phase 2: If no creature from creatureMonitor, look at Battle List as source of truth ---
    // Find creatures in battle list that are targetable but NOT currently in creatureMonitor's list
    const activeCreatureNames = new Set(creatures.map((c) => c.name));

    const targetableCreaturesFromBattleList = battleList
      .map((battleListEntry) => {
        // Only consider if it's not already detected by creatureMonitor
        if (activeCreatureNames.has(battleListEntry.name)) {
          return null;
        }

        const rule = targetingList.find(
          (r) =>
            r.name.startsWith(battleListEntry.name) && r.action === 'Attack',
          // We don't have healthTag for battle list entries here, so can't filter by healthRange
        );
        if (!rule) return null;

        // Create a synthetic creature object.
        // We don't have gameCoords or absoluteCoords yet, but manageTargetAcquisition can still work.
        // These will be filled in once the red box target is detected by creatureMonitor.
        return {
          instanceId: `bl-${battleListEntry.name}-${battleListEntry.isTarget}`,
          name: battleListEntry.name,
          distance: Infinity, // Assume far until coordinates are known
          isReachable: true, // Assume reachable if in battle list and targetable
          gameCoords: null, // Will be filled by creatureMonitor once targeted
          absoluteCoords: null, // Will be filled by creatureMonitor once targeted
          rule,
          effectivePriority: rule.priority,
        };
      })
      .filter(Boolean);

    if (targetableCreaturesFromBattleList.length > 0) {
      // Sort these battle list creatures by priority
      targetableCreaturesFromBattleList.sort((a, b) => {
        if (a.effectivePriority !== b.effectivePriority) {
          return b.effectivePriority - a.effectivePriority;
        }
        // No distance or health to sort by here, so just use name as tie-breaker
        return a.name.localeCompare(b.name);
      });
      return targetableCreaturesFromBattleList[0];
    }

    return null; // No target found anywhere
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

    const logAcquisition = (startTime) => {
      const acquisitionTime = Date.now() - startTime;
      acquisitionTimes.push(acquisitionTime);
      if (acquisitionTime > maxAcquisitionTime) {
        maxAcquisitionTime = acquisitionTime;
      }
      const sum = acquisitionTimes.reduce((a, b) => a + b, 0);
      avgAcquisitionTime = Math.round(sum / acquisitionTimes.length);
    };

    const checkTargetAndAcceptSubstitute = () => {
      const currentTarget = globalState.targeting.target;
      if (!currentTarget) return false;

      if (currentTarget.instanceId === pathfindingTarget.instanceId) {
        return true;
      }

      const isSameName =
        currentTarget.name &&
        pathfindingTarget.name &&
        currentTarget.name.startsWith(pathfindingTarget.name);
      const isAdjacent = currentTarget.distance < MELEE_DISTANCE_THRESHOLD;

      if (isSameName && isAdjacent) {
        logger(
          'info',
          `[Targeting] Accepted adjacent substitute: ${currentTarget.name}`,
        );
        targetingContext.pathfindingTarget = {
          ...currentTarget,
          rule: pathfindingTarget.rule,
        };
        return true;
      }
      return false;
    };

    const currentIndex = battleList.findIndex((e) => e.isTarget);
    let bestKeyPlan = { action: null, presses: Infinity };

    if (currentIndex === -1) {
      const firstMatchIndex = battleList.findIndex((entry) =>
        pathfindingTarget.name.startsWith(entry.name),
      );

      if (firstMatchIndex !== -1) {
        bestKeyPlan = { action: 'tab', presses: firstMatchIndex + 1 };
      }
    } else {
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

    // ====================== MODIFICATION START ======================
    // New "Press and Poll" Logic
    if (bestKeyPlan.action && bestKeyPlan.presses < Infinity) {
      const key = bestKeyPlan.action === 'tab' ? 'tab' : '`';
      const actionTriggerTime = Date.now();

      logger(
        'info',
        `[Targeting] Starting acquisition for ${pathfindingTarget.name}. Plan: ${bestKeyPlan.presses} '${key}' presses.`,
      );

      for (let i = 0; i < bestKeyPlan.presses; i++) {
        // 1. Press the key ONCE
        postInputAction('hotkey', {
          module: 'keypress',
          method: 'sendKey',
          args: [key, null],
        });
        targetingContext.lastClickTime = Date.now();
        targetingContext.acquisitionUnlockTime =
          Date.now() + TARGET_CONFIRMATION_TIMEOUT_MS + 50;

        // 2. Start the intelligent polling wait
        const pollStartTime = Date.now();
        let acquired = false;

        while (Date.now() - pollStartTime < TARGET_CONFIRMATION_TIMEOUT_MS) {
          const currentTarget = globalState.targeting.target;

          // Exit Condition 1: Target died or disappeared mid-press. Abort.
          if (!currentTarget) {
            logger(
              'warn',
              '[Targeting] Target disappeared during acquisition. Aborting.',
            );
            return;
          }

          // Exit Condition 2: Success! We targeted the correct creature.
          if (checkTargetAndAcceptSubstitute()) {
            logAcquisition(actionTriggerTime);
            acquired = true;
            break; // Exit the polling loop
          }

          await delay(CLICK_POLL_INTERVAL_MS);
        }

        // If we successfully acquired the target, the entire process is done.
        if (acquired) {
          logger(
            'info',
            `[Targeting] Successfully acquired ${pathfindingTarget.name}.`,
          );
          return;
        }
        // If we timed out, the loop will continue to the next key press.
      }

      // If the entire loop finishes and we never acquired the target, it's a failure.
      logger(
        'warn',
        `[Targeting] Failed to acquire target ${pathfindingTarget.name} after ${bestKeyPlan.presses} presses.`,
      );
    } else {
      logger(
        'warn',
        `[Targeting] Target ${pathfindingTarget.name} not found in battle list. Cannot acquire.`,
      );
    }
    // ======================= MODIFICATION END =======================
  };

  const manageMovement = async (
    targetingContext,
    globalState,
    pathfindingTarget,
    path,
    pathfindingStatus,
    playerMinimapPosition,
    isTargetInStableMelee, // New parameter
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

    // If the target is confirmed to be in stable melee range, do not move.
    if (isTargetInStableMelee) {
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

        postInputAction('targeting', {
          module: 'keypress',
          method: 'sendKey',
          args: [dirKey, null],
        });
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