// targeting/targetingLogic.js

const MOVEMENT_COOLDOWN_MS = 50;

/**
 * Selects the best target from a list of creatures based on targeting rules.
 * This function is "pure" - it doesn't consider the current state, only the best possible choice right now.
 * @returns {object|null} The best creature object or null if no valid target is found.
 */
export function selectBestTarget(sabStateManager, targetingList) {
  const creatures = sabStateManager.getCreatures();
  if (!targetingList?.length || !creatures?.length) {
    return null;
  }

  const findRuleForCreature = (creature) => {
    if (!creature || !creature.name) return null;
    return targetingList.find(
      (r) => r.action === 'Attack' && r.name === creature.name
    );
  };

  const validCandidates = creatures
    .map((creature) => {
      const rule = findRuleForCreature(creature);
      if (!rule || !creature.isReachable) {
        return null;
      }
      if (rule.onlyIfTrapped && !creature.isBlockingPath) {
        return null;
      }

      // Lower score is better.
      let score = -rule.priority * 1000; // Higher priority = much lower score.
      score += creature.distance; // Closer is better.
      if (creature.isAdjacent) {
        score -= 500; // Strongly prefer adjacent creatures.
      }

      return { creature, rule, score };
    })
    .filter(Boolean);

  if (validCandidates.length === 0) {
    return null;
  }

  validCandidates.sort((a, b) => a.score - b.score);
  return validCandidates[0].creature;
}

/**
 * Clicks the next available entry in the battle list for a given creature name.
 * @returns {{success: boolean, reason?: string, clickedIndex?: number}}
 */
export function acquireTarget(
  sabStateManager,
  parentPort,
  targetName,
  lastClickedIndex
) {
  const battleList = sabStateManager.getBattleList() || [];
  const potentialEntries = battleList
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.name === targetName);

  if (potentialEntries.length === 0) {
    return { success: false, reason: 'not_in_battlelist' };
  }

  // Find the next entry to click after the last one we tried
  let nextEntry = potentialEntries.find(
    (entry) => entry.index > lastClickedIndex
  );

  // If no entry is found after the last index, wrap around to the first one
  if (!nextEntry) {
    nextEntry = potentialEntries[0];
  }

  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'hotkey',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: [nextEntry.x, nextEntry.y],
      },
    },
  });

  return { success: true, clickedIndex: nextEntry.index };
}

/**
 * Updates the pathfinding goal for the cavebot module.
 */
export function updateDynamicTarget(parentPort, pathfindingTarget, targetingList) {
  if (!pathfindingTarget) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: null,
    });
    return;
  }

  const rule = targetingList.find((r) => r.name === pathfindingTarget.name);
  if (!rule) return;

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
}

/**
 * Manages movement towards the target.
 */
export async function manageMovement(
  workerContext,
  targetingContext,
  currentTarget
) {
  const {
    path,
    playerMinimapPosition,
    parentPort,
    sabStateManager,
  } = workerContext;
  const { targetingList } = targetingContext;

  if (!currentTarget || sabStateManager.isLootingRequired()) return;

  const rule = targetingList.find((r) => r.name === currentTarget.name);
  if (!rule || rule.stance === 'Stand') return;

  const desiredDistance = rule.distance === 0 ? 1 : rule.distance;
  if (
    (desiredDistance === 1 && currentTarget.isAdjacent) ||
    currentTarget.distance <= desiredDistance
  ) {
    return; // We are at the desired distance, no need to move.
  }

  const now = Date.now();
  if (
    path.length < 2 ||
    now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS
  ) {
    return;
  }

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

  const nextStep = path[1];
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

  if (dirKey) {
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: 'movement',
        action: { module: 'keypress', method: 'sendKey', args: [dirKey, null] },
      },
    });
    targetingContext.lastMovementTime = now;
  }
}