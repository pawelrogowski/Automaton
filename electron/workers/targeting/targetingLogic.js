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
  STATIONARY_THRESHOLD_MS: 300,
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
 * Selects the best target from a list of creatures based on targeting rules.
 * This function is "pure" - it doesn't consider the current state, only the best possible choice right now.
 * 
 * Special case: If a rule with name "Others" or "others" exists, it will match any creature
 * that doesn't have an explicit rule defined. This acts as a catch-all fallback.
 * 
 * @param {Function} getCreatures - Function that returns array of creatures
 * @param {Array} targetingList - List of targeting rules
 * @param {object|null} currentTarget - Currently targeted creature (for hysteresis)
 * @returns {object|null} The best creature object or null if no valid target is found.
 */
export function selectBestTarget(getCreatures, targetingList, currentTarget = null) {
  const creatures = getCreatures();
  if (!targetingList?.length || !creatures?.length) {
    return null;
  }
  
  // Debug logging removed to reduce spam

  // Get explicit creature names (excluding "Others" wildcard)
  const explicitNames = new Set(
    targetingList
      .filter((r) => r.action === 'Attack' && r.name.toLowerCase() !== 'others')
      .map((r) => r.name)
  );

  // Find the "Others" rule if it exists
  const othersRule = targetingList.find(
    (r) => r.action === 'Attack' && r.name.toLowerCase() === 'others'
  );

  const findRuleForCreature = (creature) => {
    if (!creature || !creature.name) {
      return null;
    }
    
    // First try to find an explicit rule
    const explicitRule = targetingList.find(
      (r) => r.action === 'Attack' && r.name === creature.name
    );
    
    if (explicitRule) {
      return explicitRule;
    }
    
    // If no explicit rule and "Others" exists, use it as fallback
    if (othersRule && !explicitNames.has(creature.name)) {
      return { ...othersRule, isWildcard: true, originalName: creature.name };
    }
    
    return null;
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
  const bestCandidate = validCandidates[0];
  
  // Hysteresis: If we have a current target, only switch if the new target is significantly better
  if (currentTarget && currentTarget.instanceId) {
    const currentCandidate = validCandidates.find(
      (c) => c.creature.instanceId === currentTarget.instanceId
    );
    
    if (currentCandidate) {
      const SCORE_THRESHOLD = 10; // Must be at least 10 points better to switch
      const scoreDifference = currentCandidate.score - bestCandidate.score;
      
      // Only switch if the best candidate is significantly better (lower score)
      if (scoreDifference < SCORE_THRESHOLD) {
        // Current target is still good enough, keep it
        return currentTarget;
      }
    }
  }
  
  return bestCandidate.creature;
}

/**
 * Clicks the next available entry in the battle list for a given creature name,
 * or uses the Tab key if the target is the first entry (and nothing is targeted) or next after the current target.
 * @returns {{success: boolean, reason?: string, clickedIndex?: number}}
 */
export function acquireTarget(
  getBattleList,
  parentPort,
  targetName,
  lastClickedIndex,
  globalState = null,  // Optional: for region/player position access
  getCreatures = null,  // Function to get creatures array
  getPlayerPosition = null,  // Function to get player position
  targetInstanceId = null  // NEW: Specific instance ID to target (prevents wrong creature)
) {
  const battleList = getBattleList() || [];
  if (battleList.length === 0) {
    return { success: false, reason: 'battlelist_empty' };
  }

  // Find the desired target and current target indices
  // Support truncated names (e.g., "troll trained sala..." matching "troll trained salamander")
  const desiredTargetEntry = battleList.find((entry) => {
    if (entry.name === targetName) return true;
    // Check if battle list entry is truncated (ends with ...)
    if (entry.name.endsWith('...')) {
      const truncatedPart = entry.name.slice(0, -3);
      return targetName.startsWith(truncatedPart);
    }
    return false;
  });
  if (!desiredTargetEntry) {
    return { success: false, reason: 'not_in_battlelist' };
  }

  const desiredTargetIndex = battleList.indexOf(desiredTargetEntry);
  const currentTargetIndex = battleList.findIndex(entry => entry.isTarget);

  // Get creatures for game world click logic (optional)
  const creatures = getCreatures ? getCreatures() : [];
  // If we have a specific instance ID, use it to find the EXACT creature we want to path to
  const targetCreature = targetInstanceId 
    ? creatures.find(c => c.instanceId === targetInstanceId && c.isReachable)
    : creatures.find(c => c.name === targetName && c.isReachable);
  
  if (targetCreature && GAMEWORLD_CONFIG.ENABLED) {
    if (targetCreature.hp !== 'Obstructed') {
      const adjacentStationaryDur = targetCreature.adjacentStationaryDuration ?? 0;
      const isAdjacent = targetCreature.isAdjacent ?? false;
      
      if (isAdjacent && adjacentStationaryDur >= GAMEWORLD_CONFIG.STATIONARY_THRESHOLD_MS) {
        const regions = globalState?.regionCoordinates?.regions;
        const playerPos = getPlayerPosition ? getPlayerPosition() : null;
        
        if (regions?.gameWorld && regions?.tileSize && playerPos && targetCreature.gameCoords) {
          const clickCoords = getAbsoluteGameWorldClickCoordinates(
            targetCreature.gameCoords.x,
            targetCreature.gameCoords.y,
            playerPos,
            regions.gameWorld,
            regions.tileSize,
            'center'
          );
          
          if (clickCoords) {
            const offsetX = Math.floor(Math.random() * 11) - 5;
            const offsetY = Math.floor(Math.random() * 11) - 5;
            
            clickCoords.x += offsetX;
            clickCoords.y += offsetY;
            
            parentPort.postMessage({
              type: 'inputAction',
              payload: {
                type: 'targeting',
                action: {
                  module: 'mouseController',
                  method: 'leftClick',
                  args: [clickCoords.x, clickCoords.y],
                },
              },
            });
            
            return {
              success: true, 
              clickedIndex: desiredTargetIndex, 
              method: 'gameworld'
            };
          }
        }
      }
    }
  }

  // --- ORIGINAL: Determine the targeting method ---
  // Tab: Move forward (currentIndex + 1 = desiredIndex)
  // Grave: Move backward (currentIndex - 1 = desiredIndex)
  // Mouse: Everything else OR 15% random override
  
  let method = null; // 'tab', 'grave', or 'mouse'
  
  // Check if we can use Tab or Grave
  const canUseTab = desiredTargetIndex === currentTargetIndex + 1;
  const canUseGrave = currentTargetIndex !== -1 && desiredTargetIndex === currentTargetIndex - 1;
  
  // 15% chance to force mouse click even when Tab/Grave would work
  const forceMouseClick = Math.random() < 0.15;
  
  if (canUseTab && !forceMouseClick) {
    method = 'tab';
  } else if (canUseGrave && !forceMouseClick) {
    method = 'grave';
  } else {
    method = 'mouse';
  }

  // --- KEYBOARD METHOD (Tab or Grave) ---
  if (method === 'tab' || method === 'grave') {
    const key = method === 'tab' ? 'tab' : 'grave';
    
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: 'targeting',
        action: {
          module: 'keypress',
          method: 'sendKey',
          args: [key, null],
        },
      },
    });
    
    return { success: true, clickedIndex: desiredTargetIndex, method };
  }

  // --- MOUSE CLICK METHOD ---
  // Get all entries with matching name (including truncated names)
  const potentialEntries = battleList
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => {
      if (entry.name === targetName) return true;
      // Check if battle list entry is truncated (ends with ...)
      if (entry.name.endsWith('...')) {
        const truncatedPart = entry.name.slice(0, -3);
        return targetName.startsWith(truncatedPart);
      }
      return false;
    });

  if (potentialEntries.length === 0) {
    return { success: false, reason: 'not_in_battlelist' };
  }

  // NEW: If we have a specific instance ID and multiple creatures with the same name,
  // try to match by screen position (Y coordinate) to click the right one
  let targetEntry = null;
  if (targetInstanceId && potentialEntries.length > 1 && targetCreature && targetCreature.absoluteCoords) {
    // Find battle list entry closest to the target creature's screen position
    let minDistance = Infinity;
    for (const entry of potentialEntries) {
      const distance = Math.abs(entry.y - targetCreature.absoluteCoords.y);
      if (distance < minDistance) {
        minDistance = distance;
        targetEntry = entry;
      }
    }
  }
  
  // Fallback to original logic if no specific instance or only one entry
  if (!targetEntry) {
    // Find the next entry to click after the last one we tried
    targetEntry = potentialEntries.find(
      (entry) => entry.index > lastClickedIndex
    );

    // If no entry is found after the last index, wrap around to the first one
    if (!targetEntry) {
      targetEntry = potentialEntries[0];
    }
  }

  // Add randomization to battle list click coordinates
  // Vertical: ±3 pixels, Horizontal: ±30 pixels
  const verticalOffset = Math.floor(Math.random() * 7) - 3; // -3 to +3
  const horizontalOffset = Math.floor(Math.random() * 61) - 30; // -30 to +30
  
  const clickX = targetEntry.x + horizontalOffset;
  const clickY = targetEntry.y + verticalOffset;
  
  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'targeting',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: [clickX, clickY],
      },
    },
  });

  return { success: true, clickedIndex: targetEntry.index, method: 'mouse' };
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

  // Use helper to find rule (supports "Others" wildcard)
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

  // Check if looting is required from unified SAB
  if (!currentTarget) {
    return;
  }
  
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
  
  if (
    !playerMinimapPosition ||
    !sabInterface ||
    !path ||
    path.length < 2
  ) {
    return;
  }

  // CRITICAL: Validate that path is for current position (prevent stale path usage)
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
  const timeSinceLastMove = movementTracking.lastMoveTimestamp > 0 
    ? now - movementTracking.lastMoveTimestamp 
    : 0;
  
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
