import { createLogger } from '../../utils/logger.js';
import {
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
  PATH_STATUS_PATH_FOUND,
  PATH_STATUS_WAYPOINT_REACHED,
} from '../sharedConstants.js';

const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;

// --- Target Acquisition Settings ---

// The maximum time to wait for the creatureMonitor to confirm that the
// in-game target has changed after clicking on a battle list entry.
// If the target is not confirmed within this window, the acquisition attempt
// is considered complete, and the main targeting loop will re-evaluate.
const TARGET_CONFIRMATION_TIMEOUT_MS = 750;

// A mandatory cooldown period between attempts to acquire a target by clicking
// the battle list. This is set *before* the click is sent. Its primary
// purpose is to prevent the bot from spam-clicking the battle list if a
// target is difficult to acquire (e.g., due to game lag or OCR issues).
// A side effect is that after a quick kill, the bot must wait for this
// cooldown to expire before attempting to target the next creature.
const TARGET_ACQUISITION_COOLDOWN_MS = 250;

export function createTargetingActions(workerContext) {
  const { playerPosArray, pathDataArray, parentPort, sabStateManager } =
    workerContext;
  const logger = createLogger({ info: false, error: true, debug: false });

  let previousSelectedTargetId = null;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const postInputAction = (type, action) =>
    parentPort.postMessage({ type: 'inputAction', payload: { type, action } });

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

  const awaitWalkConfirmation = (posCounter, pathCounter, timeoutMs) => {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        reject(new Error(`awaitWalkConfirmation timed out`));
      }, timeoutMs);
      const intervalId = setInterval(() => {
        const posChanged =
          playerPosArray &&
          Atomics.load(playerPosArray, PLAYER_POS_UPDATE_COUNTER_INDEX) >
            posCounter;
        
        if (posChanged) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(true);
        }
      }, CLICK_POLL_INTERVAL_MS);
    });
  };

  const awaitTargetConfirmation = (desiredTargetId, timeoutMs) => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const intervalId = setInterval(() => {
        const currentTarget = sabStateManager.getCurrentTarget();
        const isTargetAcquired =
          currentTarget && currentTarget.instanceId === desiredTargetId;
        const isTimedOut = Date.now() - startTime > timeoutMs;

        if (isTargetAcquired || isTimedOut) {
          clearInterval(intervalId);
          resolve(isTargetAcquired);
        }
      }, CLICK_POLL_INTERVAL_MS);
    });
  };

  const findRuleForCreature = (creature, targetingList) => {
    if (!creature || !creature.name || !targetingList) {
      return null;
    }
    const matchingRule = targetingList.find(
      (r) => r.action === 'Attack' && r.name === creature.name,
    );
    return matchingRule || null;
  };

  // =================================================================================
  // --- FINAL selectBestTarget FUNCTION with TARGET SYNCHRONIZATION ---
  // =================================================================================
  const selectBestTarget = (globalState, currentPathfindingTarget) => {
    const { targetingList } = globalState.targeting;
    const creatures = sabStateManager.getCreatures();
    const currentTarget = sabStateManager.getCurrentTarget();

    if (!targetingList?.length || !creatures?.length) {
      return { creature: null, rule: null };
    }

    const validCandidates = creatures
      .map((creature) => {
        const rule = findRuleForCreature(creature, targetingList);
        if (!rule) {
          return null;
        }

        if (rule.onlyIfTrapped && !creature.isBlockingPath) {
          return null;
        }

        if (!creature.isReachable) {
          return null;
        }

        // Higher priority number means more important (lower score)
        let score = -rule.priority * 1000;

        // Apply stickiness bonus
        if (
          currentPathfindingTarget &&
          creature.instanceId === currentPathfindingTarget.instanceId
        ) {
          score -= (rule.stickiness || 0) * 100;
        }

        // Add distance as a final tie-breaker
        score += creature.distance;

        // Add a large bonus for adjacent creatures to prevent thrashing
        if (creature.isAdjacent) {
          score -= 500;
        }

        return {
          creature,
          rule,
          score,
        };
      })
      .filter(Boolean);

    if (validCandidates.length === 0) {
      if (previousSelectedTargetId !== null) {
        logger('info', '[selectBestTarget] No valid targets found.');
        previousSelectedTargetId = null;
      }
      return { creature: null, rule: null };
    }

    // Sort by score (lower is better)
    validCandidates.sort((a, b) => a.score - b.score);

    const bestCandidate = validCandidates[0];
    let bestTarget = bestCandidate.creature;
    const bestRule = bestCandidate.rule;

    // "Same Name" Stability Logic
    if (
      currentTarget &&
      bestTarget &&
      currentTarget.name === bestTarget.name &&
      currentTarget.instanceId !== bestTarget.instanceId
    ) {
      // If the best candidate has the same name as our current target,
      // just stick with the current target to prevent thrashing.
      const currentTargetDetails = creatures.find(
        (c) => c.instanceId === currentTarget.instanceId,
      );
      if (currentTargetDetails) {
        bestTarget = currentTargetDetails;
      }
    }

    if (bestTarget && bestTarget.instanceId !== previousSelectedTargetId) {
      logger(
        'info',
        `[selectBestTarget] New best target selected: ${bestTarget.name} (ID: ${bestTarget.instanceId})`,
      );
      previousSelectedTargetId = bestTarget.instanceId;
    }

    return { creature: bestTarget, rule: bestRule };
  };

  const manageTargetAcquisition = async (
    targetingContext,
    pathfindingTarget,
    globalState,
  ) => {
    const currentTarget = sabStateManager.getCurrentTarget();
    const battleList = sabStateManager.getBattleList();

    if (!pathfindingTarget) return;

    // Guard: If we already have the correct target, do nothing.
    if (
      currentTarget &&
      currentTarget.instanceId === pathfindingTarget.instanceId
    ) {
      return;
    }

    const now = Date.now();
    if (now < targetingContext.acquisitionUnlockTime) return;

    // Find all battle list entries that match the target's name
    const potentialEntries = battleList
      .map((entry, index) => ({ ...entry, index })) // Preserve original index
      .filter((entry) => entry.name === pathfindingTarget.name);

    if (potentialEntries.length === 0) {
      return; // No entries to click
    }

    // Find the best, untried entry by correlating screen position
    let bestUntriedEntry = null;
    let minDistance = Infinity;

    for (const entry of potentialEntries) {
      const coordString = `${entry.x},${entry.y}`;
      if (targetingContext.attemptedClickCoords.has(coordString)) {
        continue; // Skip entries we've already tried for this instance
      }

      const dist = Math.sqrt(
        Math.pow(entry.x - pathfindingTarget.absoluteCoords.x, 2) +
          Math.pow(entry.y - pathfindingTarget.absoluteCoords.y, 2),
      );

      if (dist < minDistance) {
        minDistance = dist;
        bestUntriedEntry = entry;
      }
    }

    if (bestUntriedEntry) {
      const coordString = `${bestUntriedEntry.x},${bestUntriedEntry.y}`;
      targetingContext.attemptedClickCoords.add(coordString); // Mark this coord as attempted

      targetingContext.acquisitionUnlockTime =
        now + TARGET_ACQUISITION_COOLDOWN_MS;

      logger(
        'info',
        `[Targeting] Attempting to acquire ${pathfindingTarget.name} (instance #${pathfindingTarget.instanceId}) by clicking battle list at ${coordString}.`,
      );

      postInputAction('hotkey', {
        module: 'mouseController',
        method: 'leftClick',
        args: [bestUntriedEntry.x, bestUntriedEntry.y],
      });

      // Wait for the game to update the target before proceeding.
      await awaitTargetConfirmation(
        pathfindingTarget.instanceId,
        TARGET_CONFIRMATION_TIMEOUT_MS,
      );
    }
  };

  const updateDynamicTarget = (pathfindingTarget, rule) => {
    if (!pathfindingTarget || !rule) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      return;
    }

    const dynamicGoal = {
      stance: rule.stance || 'Follow',
      distance: rule.distance ?? 1,
      targetCreaturePos: pathfindingTarget.gameCoords,
      targetInstanceId: pathfindingTarget.instanceId,
    };

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: dynamicGoal,
    });
  };

  const manageMovement = async (
    targetingContext,
    path,
    pathfindingStatus,
    playerMinimapPosition,
    pathfindingTarget,
    rule,
  ) => {
    if (!pathfindingTarget || !rule) return;
    if (sabStateManager.isLootingRequired()) return;

    const desiredDistance = rule.distance === 0 ? 1 : rule.distance;
    // For melee, rely only on the isAdjacent flag which uses rawDistance and is more responsive.
    if (desiredDistance === 1) {
      if (pathfindingTarget.isAdjacent) return;
    } else {
      // For ranged, use the stabilized Chebyshev distance.
      if (pathfindingTarget.distance <= desiredDistance) return;
    }

    if (rule.stance === 'Stand') return;

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
    if (
      ![PATH_STATUS_PATH_FOUND, PATH_STATUS_WAYPOINT_REACHED].includes(
        pathfindingStatus,
      ) ||
      path.length < 2 ||
      now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS
    )
      return;

    const nextStep = path[1];
    const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

    if (dirKey) {
      const posCounter = Atomics.load(
        playerPosArray,
        PLAYER_POS_UPDATE_COUNTER_INDEX,
      );
      const pathCounter = Atomics.load(
        pathDataArray,
        PATH_UPDATE_COUNTER_INDEX,
      );
      const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
      const timeout = isDiagonal
        ? MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS
        : MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS;

      postInputAction('movement', {
        module: 'keypress',
        method: 'sendKey',
        args: [dirKey, null],
      });
      targetingContext.lastMovementTime = now;

      try {
        await awaitWalkConfirmation(posCounter, pathCounter, timeout);
        if (isDiagonal) await delay(MOVE_CONFIRM_GRACE_DIAGONAL_MS);
      } catch (error) {
        logger(
          'debug',
          `[manageMovement] Movement failed: ${error.message}, continuous loop will retry`,
        );
      }
    }
  };

  return {
    selectBestTarget,
    manageTargetAcquisition,
    updateDynamicTarget,
    manageMovement,
  };
}
