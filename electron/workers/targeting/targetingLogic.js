// targeting/targetingLogic.js

import {
  getAbsoluteGameWorldClickCoordinates,
} from '../../utils/gameWorldClickTranslator.js';
import {
  awaitWalkConfirmation,
  getDirectionKey,
  isDiagonalMovement,
} from '../movementUtils/confirmationHelpers.js';

// ==================== GAME WORLD CLICK CONFIG ====================
// Production-ready configuration based on testing

const GAMEWORLD_CONFIG = {
  ENABLED: true,
};

// ====================================================================

// Movement tracking for logging
const movementTracking = {
  lastMoveTimestamp: 0,
  moveCount: 0,
  lastLogTime: 0,
};

/**
 * Helper function to find the appropriate targeting rule for a creature.
 * Supports "Others" wildcard matching for creatures without explicit rules.
 * @param {string} creatureName - The name of the creature
 * @param {Array} targetingList - List of targeting rules
 * @returns {object|null} The matching rule or null
 */
export function findRuleForCreatureName(creatureName, targetingList) {
  if (!creatureName || !targetingList?.length) return null;
  
  // First try to find an explicit rule
  const explicitRule = targetingList.find(
    (r) => r.action === 'Attack' && r.name === creatureName
  );
  
  if (explicitRule) {
    return explicitRule;
  }
  
  // Check if "Others" wildcard rule exists
  const othersRule = targetingList.find(
    (r) => r.action === 'Attack' && r.name.toLowerCase() === 'others'
  );
  
  if (othersRule) {
    // Get all explicit creature names
    const explicitNames = new Set(
      targetingList
        .filter((r) => r.action === 'Attack' && r.name.toLowerCase() !== 'others')
        .map((r) => r.name)
    );
    
    // If this creature has no explicit rule, use "Others"
    if (!explicitNames.has(creatureName)) {
      return othersRule;
    }
  }
  
  return null;
}

/**
 * Selects the best target from a list of creatures based on a deterministic, priority-based ruleset.
 * @param {Function} getCreatures - Function that returns array of creatures.
 * @param {Array} targetingList - List of targeting rules.
 * @param {object|null} currentTarget - Currently targeted creature for stickiness logic.
 * @returns {object|null} The best creature object or null if no valid target is found.
 */
export function selectBestTarget(getCreatures, targetingList, currentTarget = null) {
  const allCreatures = getCreatures();
  if (!targetingList?.length || !allCreatures?.length) {
    return null;
  }

  const getRule = (creature) => findRuleForCreatureName(creature.name, targetingList);

  const validCandidates = allCreatures.filter(c => {
    const rule = getRule(c);
    return c.isReachable && rule && rule.action === 'Attack';
  });

  if (validCandidates.length === 0) {
    return null;
  }

  const pickBest = (candidates) => {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    
    // If currentTarget is among candidates, prefer it (stickiness)
    if (currentTarget && candidates.find(c => c.instanceId === currentTarget.instanceId)) {
      return candidates.find(c => c.instanceId === currentTarget.instanceId);
    }
    
    const adjacent = candidates.filter(c => c.isAdjacent);
    if (adjacent.length > 0) {
      return adjacent.sort((a, b) => a.distance - b.distance)[0];
    }
    return candidates.sort((a, b) => a.distance - b.distance)[0];
  };

  // Rule 1: Handle existing target (Stickiness)
  if (currentTarget && currentTarget.instanceId) {
    const currentTargetStillValid = validCandidates.find(c => c.instanceId === currentTarget.instanceId);

    if (currentTargetStillValid) {
      const currentRule = getRule(currentTargetStillValid);
      if (!currentRule) { // Should be impossible due to filter, but as a safeguard
        // Fall through to pick a new target
      } else {
        const higherPriorityCandidates = validCandidates.filter(c => {
          const newRule = getRule(c);
          return newRule && newRule.priority > currentRule.priority;
        });

        if (higherPriorityCandidates.length > 0) {
          // A better priority target exists, we MUST switch.
          return pickBest(higherPriorityCandidates);
        } else {
          // No higher priority target exists, so we MUST stick to the current one.
          return currentTargetStillValid;
        }
      }
    }
    // If we are here, it means the current target is no longer valid (unreachable, died, etc.)
    // so we fall through to pick a new one from scratch.
  }

  // Rule 2: Pick a new target from all valid candidates
  let highestPriority = -Infinity;
  for (const candidate of validCandidates) {
    const rule = getRule(candidate);
    if (rule && rule.priority > highestPriority) {
      highestPriority = rule.priority;
    }
  }

  const topPriorityCandidates = validCandidates.filter(c => {
    const rule = getRule(c);
    return rule && rule.priority === highestPriority;
  });

  return pickBest(topPriorityCandidates);
}

/**
 * Acquires a target by exclusively clicking on the creature in the game world.
 * @returns {{success: boolean, reason?: string, method?: string}}
 */
export function acquireTarget(
  getBattleList, // No longer used, but kept for API compatibility
  parentPort,
  targetName, // No longer used, but kept for API compatibility
  lastClickedIndex, // No longer used
  globalState = null,
  getCreatures = null,
  getPlayerPosition = null,
  targetInstanceId = null
) {
  const creatures =  getCreatures();
  
  const targetCreature = targetInstanceId 
    ? creatures.find(c => c.instanceId === targetInstanceId)
    : null;

  if (!targetCreature) {
    return { success: false, reason: 'target_instance_not_found' };
  }

  if (!targetCreature.isReachable) {
    return { success: false, reason: 'target_not_reachable' };
  }

  
  
  if (targetCreature.absoluteX !== 0 && targetCreature.absoluteY !== 0) {
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: 'targeting',
        action: {
          module: 'mouseController',
          method: 'leftClick',
          args: [targetCreature.absoluteX, targetCreature.absoluteY],
        },
        ttl: 55, // Time-to-live: discard if not executed within 55ms
      },
    });
    
    return {
      success: true, 
      method: 'gameworld'
    };
  }

  return { success: false, reason: 'gameworld_click_not_possible' };
}

export function updateDynamicTarget(parentPort, pathfindingTarget, targetingList) {
  if (!pathfindingTarget) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: null,
    });
    return;
  }

  const rule = findRuleForCreatureName(pathfindingTarget.name, targetingList);
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
    sabInterface,
  } = workerContext;
  const { targetingList } = targetingContext;

  if (!currentTarget) {
    return;
  }
  
  // Check if looting is required from unified SAB
  if (sabInterface) {
    try {
      const lootingResult = sabInterface.get('looting');
      if (lootingResult && lootingResult.data && lootingResult.data.required === 1) {
        return;  // Skip movement while looting
      }
    } catch (err) {
      // Continue with movement if looting check fails
    }
  }

  const rule = findRuleForCreatureName(currentTarget.name, targetingList);
  
  if (!rule || rule.stance === 'Stand') {
    return;
  }

  const desiredDistance = rule.distance === 0 ? 1 : rule.distance;
  
  if (rule.stance === 'Reach') {
    if (currentTarget.isAdjacent) {
      return;
    }
  } else {
    if (
      (desiredDistance === 1 && currentTarget.isAdjacent) ||
      currentTarget.distance <= desiredDistance
    ) {
      return;
    }
  }
  
  if (!playerMinimapPosition || !sabInterface) {
    return;
  }
  
  if (!path || path.length < 2) {
    return;
  }
  
  // Validate path is for current target (prevent using path for different creature)
  if (workerContext.pathInstanceId !== currentTarget.instanceId) {
    return; // Path is for different creature, wait for new path
  }

  // FIX: Validate that path is for current position (prevent stale path usage)
  const pathStart = path[0];
  const isPathStale = 
    pathStart.x !== playerMinimapPosition.x ||
    pathStart.y !== playerMinimapPosition.y ||
    pathStart.z !== playerMinimapPosition.z;
  
  if (isPathStale) {
    // Path is stale - silently skip movement and wait for new path
    return;
  }

  const nextStep = path[1];
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

  if (!dirKey) {
    return;
  }

  const timeout = isDiagonalMovement(dirKey) ? 900 : 400;
  const now = Date.now();
  
  movementTracking.lastMoveTimestamp = now;
  movementTracking.moveCount++;
  
  // Set movement lock BEFORE sending keypress (prevent double-stepping)
  workerContext.isWaitingForMovement = true;
  workerContext.movementWaitUntil = now + timeout;

  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'movement',
      action: { module: 'keypress', method: 'sendKey', args: [dirKey, null] },
    },
  });

  try {
    await awaitWalkConfirmation(
      workerContext,
      { stateChangePollIntervalMs: 5 },
      timeout
    );
    // Movement confirmed - clear lock
    workerContext.isWaitingForMovement = false;
  } catch (error) {
    // Movement failed - clear lock and silently retry on next iteration
    workerContext.isWaitingForMovement = false;
  }
}
