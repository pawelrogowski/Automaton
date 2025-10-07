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
 * @returns {object|null} The best creature object or null if no valid target is found.
 */
export function selectBestTarget(sabStateManager, targetingList) {
  const creatures = sabStateManager.getCreatures();
  if (!targetingList?.length || !creatures?.length) {
    return null;
  }

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
  return validCandidates[0].creature;
}

/**
 * Clicks the next available entry in the battle list for a given creature name,
 * or uses the Tab key if the target is the first entry (and nothing is targeted) or next after the current target.
 * @returns {{success: boolean, reason?: string, clickedIndex?: number}}
 */
export function acquireTarget(
  sabStateManager,
  parentPort,
  targetName,
  lastClickedIndex,
  globalState = null  // Optional: for region/player position access
) {
  const battleList = sabStateManager.getBattleList() || [];
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

  const creatures = sabStateManager.getCreatures();
  const targetCreature = creatures.find(c => c.name === targetName && c.isReachable);
  
  if (targetCreature && GAMEWORLD_CONFIG.ENABLED) {
    if (targetCreature.hp !== 'Obstructed') {
      const adjacentStationaryDur = targetCreature.adjacentStationaryDuration ?? 0;
      const isAdjacent = targetCreature.isAdjacent ?? false;
      
      if (isAdjacent && adjacentStationaryDur >= GAMEWORLD_CONFIG.STATIONARY_THRESHOLD_MS) {
        const regions = globalState?.regionCoordinates?.regions;
        const playerPos = sabStateManager.getCurrentPlayerPosition();
        
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

  // Find the next entry to click after the last one we tried
  let targetEntry = potentialEntries.find(
    (entry) => entry.index > lastClickedIndex
  );

  // If no entry is found after the last index, wrap around to the first one
  if (!targetEntry) {
    targetEntry = potentialEntries[0];
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
    sabStateManager,
    playerPosArray,
    pathDataArray,
    lastPlayerPosCounter,
    lastPathDataCounter,
  } = workerContext;
  const { targetingList } = targetingContext;

  if (!currentTarget || sabStateManager.isLootingRequired()) {
    return;
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
    !playerPosArray ||
    !pathDataArray ||
    path.length < 2 ||
    workerContext.pathInstanceId !== currentTarget.instanceId
  ) {
    return;
  }

  const nextStep = path[1];
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

  if (!dirKey) {
    return;
  }

  const timeout = isDiagonalMovement(dirKey) ? 750 : 400;

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
      lastPlayerPosCounter,
      lastPathDataCounter,
      timeout
    );
  } catch (error) {
    // Movement timed out - acceptable, just continue
  }
}
