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
const TARGET_ACQUISITION_COOLDOWN_MS = 250; // Cooldown between tab presses

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

    // --- TARGET SYNCHRONIZATION ---
    // If we have a red-box target and it's a valid, reachable creature on our list,
    // ALWAYS prioritize it. This forces pathfinding to sync with the actual target.
    if (currentTarget) {
      const currentTargetDetails = creatures.find(
        (c) => c.instanceId === currentTarget.instanceId,
      );
      if (currentTargetDetails && currentTargetDetails.isReachable) {
        const rule = findRuleForCreature(currentTargetDetails, targetingList);
        if (rule) {
          // It's our confirmed, valid, in-game target. Stick to it.
          return { creature: currentTargetDetails, rule: rule };
        }
      }
    }

    const validCandidates = creatures
      .map((creature) => {
        const rule = findRuleForCreature(creature, targetingList);
        if (!creature.isReachable || !rule) {
          return null;
        }

        // Calculate an evaluation score, lower is better.
        let evaluationDistance = creature.distance;

        // Apply stickiness bonus if this creature is the current target
        if (
          currentPathfindingTarget &&
          creature.instanceId === currentPathfindingTarget.instanceId
        ) {
          // Stickiness from 1-10. Each point gives a 7.5% "distance reduction" for evaluation purposes.
          // This creates a "gravity well" around the current target.
          const stickinessFactor = 1.0 - (rule.stickiness || 1) * 0.075;
          evaluationDistance *= stickinessFactor;
        }

        return {
          creature,
          rule,
          evaluationDistance,
        };
      })
      .filter(Boolean); // Remove null entries (creatures that weren't valid)

    if (validCandidates.length === 0) {
      if (previousSelectedTargetId !== null) {
        logger('info', '[selectBestTarget] No valid targets found.');
        previousSelectedTargetId = null;
      }
      return { creature: null, rule: null };
    }

    // Sort by the calculated evaluation distance to find the best candidate
    validCandidates.sort((a, b) => a.evaluationDistance - b.evaluationDistance);

    const bestCandidate = validCandidates[0];
    const bestTarget = bestCandidate.creature;
    const bestRule = bestCandidate.rule;

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
    const { targetingList } = globalState.targeting;

    // If there's no best target, do nothing.
    if (!pathfindingTarget) return;

    // If we are already targeting the best creature, do nothing.
    if (
      currentTarget &&
      currentTarget.instanceId === pathfindingTarget.instanceId
    ) {
      return;
    }

    // If we are targeting *something* and it's a valid creature from our list,
    // be patient and don't press Tab. The selectBestTarget logic will now
    // force the pathfinder to follow this creature.
    if (currentTarget) {
      const isCurrentTargetInList = targetingList.some(
        (rule) => rule.name === currentTarget.name && rule.action === 'Attack',
      );
      if (isCurrentTargetInList) {
        return;
      }
    }

    // If we reach here, it means we either have no target, or our current target
    // is not on our attack list. In either case, it's safe to press Tab to
    // acquire a new, better target.
    const now = Date.now();
    if (now < targetingContext.acquisitionUnlockTime) return;
    targetingContext.acquisitionUnlockTime =
      now + TARGET_ACQUISITION_COOLDOWN_MS;

    logger(
      'info',
      `[Targeting] Attempting to acquire target ${pathfindingTarget.name} (ID: ${pathfindingTarget.instanceId}). Pressing Tab.`,
    );
    postInputAction('hotkey', {
      module: 'keypress',
      method: 'sendKey',
      args: ['tab', null],
    });

    // Wait for the game to update the target, with a timeout.
    await awaitTargetConfirmation(pathfindingTarget.instanceId, 400);
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
