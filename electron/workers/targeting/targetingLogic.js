// targeting/targetingLogic.js

import { getAbsoluteGameWorldClickCoordinates } from '../../utils/gameWorldClickTranslator.js';
import {
  awaitWalkConfirmation,
  getDirectionKey,
  isDiagonalMovement,
} from '../movementUtils/confirmationHelpers.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger({ info: false, error: true, debug: false });

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
  if (!creatureName || !targetingList?.length) {
    return null;
  }

  // First try to find an explicit rule
  const explicitRule = targetingList.find(
    (r) => r.action === 'Attack' && r.name === creatureName,
  );

  if (explicitRule) {
    return explicitRule;
  }

  // Check if "Others" wildcard rule exists
  const othersRule = targetingList.find(
    (r) => r.action === 'Attack' && r.name.toLowerCase() === 'others',
  );

  if (othersRule) {
    // Get all explicit creature names
    const explicitNames = new Set(
      targetingList
        .filter(
          (r) => r.action === 'Attack' && r.name.toLowerCase() !== 'others',
        )
        .map((r) => r.name),
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
export function getEffectiveScore(
  creature,
  targetingList,
  isCurrentTarget = false,
  isReachable = false,
) {
  const rule = findRuleForCreatureName(creature.name, targetingList);
  if (!rule || rule.action !== 'Attack') return -Infinity;
  let score = rule.priority;
  if (isCurrentTarget && isReachable && rule.stickiness !== undefined) {
    score += rule.stickiness;
  }
  return score;
}

export function selectBestTarget(
  getCreatures,
  targetingList,
  currentTarget = null,
  graceMs = 750,
  sabInterface = null,
) {
  const allCreatures = getCreatures();
  if (!currentTarget || !currentTarget.instanceId) {
    logger(
      'info',
      `[TARGETING] [SELECT_BEST] No currentTarget, new selection.`,
    );
  }
  if (!targetingList?.length || !allCreatures?.length) {
    return null;
  }

  const now = Date.now();
  
  // Read blocking creature coords from SAB for onlyIfTrapped checks
  let blockingCreatureCoords = null;
  if (sabInterface) {
    try {
      const cavebotPathResult = sabInterface.get('cavebotPathData');
      if (cavebotPathResult && cavebotPathResult.data) {
        const pathData = cavebotPathResult.data;
        if (pathData.blockingCreatureX !== 0 || pathData.blockingCreatureY !== 0) {
          blockingCreatureCoords = {
            x: pathData.blockingCreatureX,
            y: pathData.blockingCreatureY,
            z: pathData.blockingCreatureZ,
          };
        }
      }
    } catch (err) {
      // Silent
    }
  }

  let effectiveReachableForCurrent = false;
  let currentTargetStillValid = null;
  if (currentTarget) {
    const lookupKey = currentTarget.instanceKey || currentTarget.instanceId;
    currentTargetStillValid = allCreatures.find(
      (c) => (c.instanceKey || c.instanceId) === lookupKey,
    );
    const isGraceValid = now - (currentTarget.acquiredAt || 0) < graceMs;
    effectiveReachableForCurrent = currentTargetStillValid
      ? currentTargetStillValid.isReachable
      : false;
    if (!effectiveReachableForCurrent && isGraceValid) {
      effectiveReachableForCurrent = true;
    }
  }

  const getRule = (creature) =>
    findRuleForCreatureName(creature.name, targetingList);

  const validCandidates = allCreatures.filter((c) => {
    const rule = getRule(c);
    const currentLookupKey = currentTarget
      ? currentTarget.instanceKey || currentTarget.instanceId
      : null;
    const cLookupKey = c.instanceKey || c.instanceId;
    const isReachableForThis =
      currentLookupKey && cLookupKey === currentLookupKey
        ? effectiveReachableForCurrent
        : c.isReachable;
    
    // Check if rule requires creature to be trapping (onlyIfTrapped)
    if (rule && rule.onlyIfTrapped && c.gameCoords) {
      // Creature is trapping if coordinates match blocking creature from pathfinder
      const isTrapping = blockingCreatureCoords &&
        c.gameCoords.x === blockingCreatureCoords.x &&
        c.gameCoords.y === blockingCreatureCoords.y &&
        c.gameCoords.z === blockingCreatureCoords.z;
      
      if (!isTrapping) {
        return false; // Skip this creature - not trapping and rule requires it
      }
    }
    
    return isReachableForThis && rule && rule.action === 'Attack';
  });
  logger(
    'info',
    `[TARGETING] [SELECT_BEST] allCreatures: ${allCreatures.length}, validCandidates: ${validCandidates.length}, current key/ID: ${currentTarget?.instanceKey || currentTarget?.instanceId}`,
  );

  if (validCandidates.length === 0) {
    return null;
  }

  const pickBest = (candidates) => {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    const adjacent = candidates.filter((c) => c.isAdjacent);
    if (adjacent.length > 0) {
      return adjacent.sort((a, b) => a.distance - b.distance)[0];
    }
    return candidates.sort((a, b) => a.distance - b.distance)[0];
  };

  // Rule 1: Handle existing target (enhanced stickiness with scores)
  if (currentTarget) {
    const lookupKey = currentTarget.instanceKey || currentTarget.instanceId;
    const currentTargetStillValid = validCandidates.find(
      (c) => (c.instanceKey || c.instanceId) === lookupKey,
    );

    if (currentTargetStillValid) {
      const currentScore = getEffectiveScore(
        currentTargetStillValid,
        targetingList,
        true,
        currentTargetStillValid.isReachable,
      );
      let bestAltScore = -Infinity;
      const alternatives = validCandidates.filter(
        (c) => (c.instanceKey || c.instanceId) !== lookupKey,
      );
      for (const alt of alternatives) {
        bestAltScore = Math.max(
          bestAltScore,
          getEffectiveScore(alt, targetingList, false, alt.isReachable),
        );
      }
      if (currentScore >= bestAltScore) {
        const currentLookupKey =
          currentTarget.instanceKey || currentTarget.instanceId;
        logger(
          'info',
          `[TARGETING] [SELECT_BEST] Sticking to key/ID ${currentLookupKey} (score ${currentScore} >= alt ${bestAltScore})`,
        );
        return currentTargetStillValid; // Stick: current effective wins/ties
      } else {
        // Switch only to strictly higher
        const higherAlts = alternatives.filter(
          (c) =>
            getEffectiveScore(c, targetingList, false, c.isReachable) >
            currentScore,
        );
        if (higherAlts.length > 0) {
          return pickBest(higherAlts);
        }
        // Else, fall through to new target selection
      }
    } else {
      logger(
        'info',
        `[TARGETING] [SELECT_BEST] Current key/ID ${currentTarget?.instanceKey || currentTarget?.instanceId} invalid, new selection.`,
      );
    }
  }

  // Rule 2: New target - group by effective score (no boost since not targeted)
  let highestScore = -Infinity;
  for (const candidate of validCandidates) {
    const score = getEffectiveScore(
      candidate,
      targetingList,
      false,
      candidate.isReachable,
    );
    if (score > highestScore) highestScore = score;
  }
  const topScoreCandidates = validCandidates.filter(
    (c) =>
      getEffectiveScore(c, targetingList, false, c.isReachable) ===
      highestScore,
  );
  return pickBest(topScoreCandidates);
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
  targetInstanceId = null,
) {
  const creatures = getCreatures();

  const targetCreature = targetInstanceId
    ? creatures.find((c) => c.instanceId === targetInstanceId)
    : null;

  if (!targetCreature) {
    return { success: false, reason: 'target_instance_not_found' };
  }

  if (!targetCreature.isReachable) {
    return { success: false, reason: 'target_not_reachable' };
  }

  // If the battle list contains exactly one creature, prefer using the Tab key
  // to cycle/target instead of performing a mouse click. This is useful for
  // situations where clicking is unreliable or unnecessary when only one
  // battle-list entry exists.
  try {
    const bl = typeof getBattleList === 'function' ? getBattleList() : [];
    const blLen = Array.isArray(bl) ? bl.length : 0;
    if (blLen === 1) {
      parentPort.postMessage({
        type: 'inputAction',
        payload: {
          type: 'targeting',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['Tab'],
          },
          ttl: 55, // keep TTL for parity with click action
        },
      });
      return {
        success: true,
        method: 'tab',
      };
    }
  } catch (e) {
    // If battle-list read fails for any reason, fall back to existing behavior
  }

  // Always force battle-list targeting - no game-world clicks
  return { success: false, reason: 'gameworld_disabled' };
}

export function updateDynamicTarget(
  parentPort,
  pathfindingTarget,
  targetingList,
) {
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
  currentTarget,
) {
  const {
    path,
    pathInstanceId,
    playerMinimapPosition,
    parentPort,
    sabInterface,
  } = workerContext;
  const { targetingList } = targetingContext;

  if (!currentTarget) {
    return;
  }

  // Looting lock: never move while looting is active
  if (sabInterface) {
    try {
      const lootingResult = sabInterface.get('looting');
      if (
        lootingResult &&
        lootingResult.data &&
        lootingResult.data.required === 1
      ) {
        return;
      }
    } catch {
      // Best-effort; on failure we proceed
    }
  }

  const rule = findRuleForCreatureName(currentTarget.name, targetingList);
  if (!rule || rule.stance === 'Stand') {
    return;
  }

  const desiredDistance = rule.distance === 0 ? 1 : rule.distance;

  // Distance / stance gating
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

  if (!playerMinimapPosition) {
    return;
  }

  // Path must come from targetingPathData: non-empty and at least [start, next]
  if (!Array.isArray(path) || path.length < 2) {
    return;
  }

  // Ownership invariant:
  // targetingPathData.header.instanceId MUST equal currentTarget.instanceId
  if (!pathInstanceId || pathInstanceId !== currentTarget.instanceId) {
    return;
  }

  // Start-position invariant:
  // path[0] MUST match current player minimap position
  const pathStart = path[0];
  if (
    !pathStart ||
    pathStart.x !== playerMinimapPosition.x ||
    pathStart.y !== playerMinimapPosition.y ||
    pathStart.z !== playerMinimapPosition.z
  ) {
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

  // Movement lock: prevent double-steps within this worker
  workerContext.isWaitingForMovement = true;
  workerContext.movementWaitUntil = now + timeout;

  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'movement',
      action: {
        module: 'keypress',
        method: 'sendKey',
        args: [dirKey, null],
      },
    },
  });

  try {
    await awaitWalkConfirmation(
      workerContext,
      { stateChangePollIntervalMs: 5 },
      timeout,
    );
  } catch {
    // Ignore; targeting loop will request a fresh path or re-evaluate
  } finally {
    workerContext.isWaitingForMovement = false;
  }
}
