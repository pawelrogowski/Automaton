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
 * Clicks the next available entry in the battle list for a given creature name,
 * or uses the Tab key if the target is the first entry (and nothing is targeted) or next after the current target.
 * @returns {{success: boolean, reason?: string, clickedIndex?: number}}
 */
/**
 * Generate a randomized return position after battle list click
 * 70% chance: Return to game world
 * 30% chance: Wiggle in battle list or drift to minimap area
 * @param {object} sabStateManager - State manager with region access
 * @param {number} clickX - X coordinate of the click
 * @param {number} clickY - Y coordinate of the click
 * @returns {object} {x, y, duration} or null
 */
function getRandomReturnPosition(sabStateManager, clickX, clickY) {
  const regions = sabStateManager.globalState?.regionCoordinates?.regions;
  
  // 70% chance to return to game world (more often out of UI)
  if (Math.random() < 0.7) {
    if (!regions?.gameWorld) return null;
    
    const gameWorld = regions.gameWorld;
    
    // Horizontal position: game world + 125px margins on left/right
    const horizontalMargin = 125;
    const extendedX = gameWorld.x - horizontalMargin;
    const extendedWidth = gameWorld.width + (horizontalMargin * 2);
    const x = extendedX + Math.floor(Math.random() * extendedWidth);
    
    // Vertical position: anywhere within game world height
    const y = gameWorld.y + Math.floor(Math.random() * gameWorld.height);
    
    return { x, y, duration: 150 };
  }
  
  // 30% chance to wiggle/drift in battle list area or minimap
  // Choose destination: 70% stay in battle list, 30% drift to minimap
  const driftToMinimap = Math.random() < 0.3;
  
  if (driftToMinimap && regions?.minimapFull) {
    // Drift to minimap area
    const minimap = regions.minimapFull;
    const x = minimap.x + Math.floor(Math.random() * minimap.width);
    const y = minimap.y + Math.floor(Math.random() * minimap.height);
    const duration = 50 + Math.floor(Math.random() * 51); // 50-100ms
    return { x, y, duration };
  } else if (regions?.battleList) {
    // Wiggle within battle list area
    const battleList = regions.battleList;
    
    // Small random offset from click position (±30px)
    const offsetX = Math.floor(Math.random() * 61) - 30; // -30 to +30
    const offsetY = Math.floor(Math.random() * 61) - 30;
    
    // Clamp to battle list bounds
    const x = Math.max(
      battleList.x,
      Math.min(battleList.x + battleList.width, clickX + offsetX)
    );
    const y = Math.max(
      battleList.y,
      Math.min(battleList.y + battleList.height, clickY + offsetY)
    );
    
    const duration = 50 + Math.floor(Math.random() * 51); // 50-100ms
    return { x, y, duration };
  }
  
  // Fallback: return null to use default behavior
  return null;
}

export function acquireTarget(
  sabStateManager,
  parentPort,
  targetName,
  lastClickedIndex
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

  // Determine the targeting method
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

  // Get randomized return position (70% game world, 30% wiggle/drift)
  const returnPos = getRandomReturnPosition(sabStateManager, targetEntry.x, targetEntry.y);
  
  // Prepare click args: [x, y, maxDuration, returnPosition]
  const clickArgs = returnPos
    ? [targetEntry.x, targetEntry.y, 200, returnPos]
    : [targetEntry.x, targetEntry.y, 200];
  
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