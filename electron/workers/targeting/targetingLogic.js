// targeting/targetingLogic.js

import {
  getAbsoluteGameWorldClickCoordinates,
} from '../../utils/gameWorldClickTranslator.js';

const MOVEMENT_COOLDOWN_MS = 50;

// ==================== GAME WORLD CLICK CONFIG ====================
// Production-ready configuration based on testing

const GAMEWORLD_CONFIG = {
  ENABLED: true,                    // Enable game world click targeting
  STATIONARY_THRESHOLD_MS: 50,      // 50ms stationary minimum (tested and working)
  ALLOW_ADJACENT: true,             // Always click adjacent creatures in game world
  PROBABILITY: 0.85,                // 85% chance for eligible creatures (adds variation)
};

// ====================================================================

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
 * Clicks the next available entry in the battle list for a given creature name,
 * or uses the Tab key if the target is the first entry (and nothing is targeted) or next after the current target.
 * @returns {{success: boolean, reason?: string, clickedIndex?: number}}
 */
/**
 * Generate a randomized return position after game world click
 * Moves cursor 1-3 tiles away from click position, staying within game world
 * @param {object} globalState - State with region access
 * @param {number} clickX - X coordinate of the click
 * @param {number} clickY - Y coordinate of the click
 * @returns {object} {x, y, duration} or null
 */
function getReturnPositionGameWorld(globalState, clickX, clickY) {
  const regions = globalState?.regionCoordinates?.regions;
  const tileSize = regions?.tileSize;
  const gameWorld = regions?.gameWorld;
  
  if (!gameWorld || !tileSize) return null;
  
  // Random tile distance: 1-3 tiles away
  const tileDistance = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
  const pixelDistance = tileDistance * tileSize.width;
  
  // Random angle for direction
  const angle = Math.random() * 2 * Math.PI;
  
  // Calculate offset
  const offsetX = Math.cos(angle) * pixelDistance;
  const offsetY = Math.sin(angle) * pixelDistance;
  
  // Candidate position
  let x = Math.round(clickX + offsetX);
  let y = Math.round(clickY + offsetY);
  
  // Clamp to game world bounds
  x = Math.max(gameWorld.x, Math.min(gameWorld.x + gameWorld.width - 1, x));
  y = Math.max(gameWorld.y, Math.min(gameWorld.y + gameWorld.height - 1, y));
  
  return { x, y, duration: 100 + Math.floor(Math.random() * 51) }; // 100-150ms
}

/**
 * Generate a randomized return position after battle list click
 * Wiggles within battle list area (±50px radius, clamped to bounds)
 * @param {object} globalState - State with region access
 * @param {number} clickX - X coordinate of the click
 * @param {number} clickY - Y coordinate of the click
 * @returns {object} {x, y, duration} or null
 */
function getReturnPositionBattleList(globalState, clickX, clickY) {
  const regions = globalState?.regionCoordinates?.regions;
  const battleList = regions?.battleList;
  
  if (!battleList) return null;
  
  // Random offset within ±50px radius
  const offsetX = Math.floor(Math.random() * 101) - 50; // -50 to +50
  const offsetY = Math.floor(Math.random() * 101) - 50;
  
  // Clamp to battle list bounds
  const x = Math.max(
    battleList.x,
    Math.min(battleList.x + battleList.width - 1, clickX + offsetX)
  );
  const y = Math.max(
    battleList.y,
    Math.min(battleList.y + battleList.height - 1, clickY + offsetY)
  );
  
  return { x, y, duration: 50 + Math.floor(Math.random() * 51) }; // 50-100ms
}

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
  const desiredTargetEntry = battleList.find((entry) => entry.name === targetName);
  if (!desiredTargetEntry) {
    return { success: false, reason: 'not_in_battlelist' };
  }

  const desiredTargetIndex = battleList.indexOf(desiredTargetEntry);
  const currentTargetIndex = battleList.findIndex(entry => entry.isTarget);

  // --- NEW: Check if we can use game world click for stationary creature ---
  const creatures = sabStateManager.getCreatures();
  const targetCreature = creatures.find(c => c.name === targetName && c.isReachable);
  
  console.log(`[GameWorld] Targeting: ${targetName}, Found: ${!!targetCreature}, Total creatures: ${creatures.length}`);
  
  // Prefer game world click if creature is stationary or adjacent
  if (targetCreature && GAMEWORLD_CONFIG.ENABLED) {
    // CRITICAL: Never use game world clicks when HP is obstructed
    // Obstructed HP means the creature might not be properly clickable in the game world
    if (targetCreature.hp === 'Obstructed') {
      console.log(`[GameWorld] ${targetName}: HP obstructed - forcing battle list/Tab`);
      // Fall through to battle list/keyboard targeting
    } else {
      const stationaryDur = targetCreature.stationaryDuration ?? 0;
      const isStationary = stationaryDur >= GAMEWORLD_CONFIG.STATIONARY_THRESHOLD_MS;
      const isAdjacent = targetCreature.isAdjacent ?? false;
    
      // Determine if we should use game world click:
      // 1. Adjacent creatures - always click (instant, no mouse travel time)
      // 2. Stationary creatures (>= 50ms) - 85% chance
      let shouldUseGameWorldClick = false;
      
      if (GAMEWORLD_CONFIG.ALLOW_ADJACENT && isAdjacent) {
        shouldUseGameWorldClick = true; // Adjacent = always safe
        console.log(`[GameWorld] ${targetName}: Adjacent creature - using game world click`);
      } else if (isStationary) {
        shouldUseGameWorldClick = Math.random() < GAMEWORLD_CONFIG.PROBABILITY;
        console.log(`[GameWorld] ${targetName}: Stationary ${stationaryDur}ms - gameworld=${shouldUseGameWorldClick}`);
      } else {
        console.log(`[GameWorld] ${targetName}: Moving/new (${stationaryDur}ms) - using Tab/BL`);
      }
      
      if (shouldUseGameWorldClick && targetCreature.gameCoords) {
        const regions = globalState?.regionCoordinates?.regions;
        const playerPos = sabStateManager.getCurrentPlayerPosition();
        
        console.log(`[GameWorld] Has regions=${!!regions}, gameWorld=${!!regions?.gameWorld}, tileSize=${!!regions?.tileSize}, playerPos=${!!playerPos}`);
        
        if (regions?.gameWorld && regions?.tileSize && playerPos) {
          const clickCoords = getAbsoluteGameWorldClickCoordinates(
            targetCreature.gameCoords.x,
            targetCreature.gameCoords.y,
            playerPos,
            regions.gameWorld,
            regions.tileSize,
            'center'
          );
          
          if (clickCoords) {
            // Add small random offset (±5 pixels) for natural variation
            const offsetX = Math.floor(Math.random() * 11) - 5; // -5 to +5
            const offsetY = Math.floor(Math.random() * 11) - 5;
            
            clickCoords.x += offsetX;
            clickCoords.y += offsetY;
            
            console.log(`[GameWorld] ✓ Dispatching game world click at (${clickCoords.x}, ${clickCoords.y})`);
            
            // Get game-world-aware return position (1-3 tiles away, within game world)
            const returnPos = getReturnPositionGameWorld(globalState, clickCoords.x, clickCoords.y);
            
            const clickArgs = returnPos
              ? [clickCoords.x, clickCoords.y, 200, returnPos]
              : [clickCoords.x, clickCoords.y, 200];
            
            parentPort.postMessage({
              type: 'inputAction',
              payload: {
                type: 'targeting',
                action: {
                  module: 'mouseController',
                  method: 'leftClick',
                  args: clickArgs,
                },
              },
            });
            
            return {
              success: true, 
              clickedIndex: desiredTargetIndex, 
              method: 'gameworld',
              stationary: isStationary,
              velocity: targetCreature.velocity
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
  // Get all entries with matching name
  const potentialEntries = battleList
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.name === targetName);

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

  // Get battle-list-aware return position (wiggle within 50px, stay in battle list)
  const returnPos = getReturnPositionBattleList(globalState, clickX, clickY);
  
  // Prepare click args: [x, y, maxDuration, returnPosition]
  const clickArgs = returnPos
    ? [clickX, clickY, 200, returnPos]
    : [clickX, clickY, 200];
  
  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'targeting',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: clickArgs,
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
    !playerMinimapPosition ||
    path.length < 2 ||
    now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS ||
    workerContext.pathInstanceId !== currentTarget.instanceId
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