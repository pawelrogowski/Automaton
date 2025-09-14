// /home/feiron/Dokumenty/Automaton/electron/workers/targeting/actions.js
import { createLogger } from '../../utils/logger.js';
import { SABStateManager } from '../sabStateManager.js';
import {
  PLAYER_POS_UPDATE_COUNTER_INDEX,
  PATH_UPDATE_COUNTER_INDEX,
} from '../sharedConstants.js';

const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;
const TARGET_CLICK_DELAY_MS = 50;
const TARGET_CONFIRMATION_TIMEOUT_MS = 375;

export function createTargetingActions(workerContext) {
  const { playerPosArray, pathDataArray, parentPort, sabStateManager } =
    workerContext;
  const logger = createLogger({ info: true, error: true, debug: false });

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
        const pathChanged =
          pathDataArray &&
          Atomics.load(pathDataArray, PATH_UPDATE_COUNTER_INDEX) > pathCounter;
        if (posChanged || pathChanged) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(true);
        }
      }, CLICK_POLL_INTERVAL_MS);
    });
  };

  const findRuleForEntry = (entryName, targetingList) => {
    if (!entryName || !targetingList) {
      logger(
        'debug',
        `[findRuleForEntry] Invalid input: entryName=${entryName}, targetingList=${!!targetingList}`,
      );
      return null;
    }

    logger(
      'debug',
      `[findRuleForEntry] Looking for rules matching: "${entryName}"`,
    );

    const matchingRules = targetingList
      .filter((r) => {
        if (r.action !== 'Attack') return false;

        // Exact match
        if (r.name === entryName) return true;

        // Handle truncated names: if entryName ends with "..." check if rule name starts with the truncated part
        if (entryName.endsWith('...')) {
          const truncatedPart = entryName.slice(0, -3);
          return r.name.startsWith(truncatedPart);
        }

        return false;
      })
      .sort((a, b) => b.priority - a.priority);

    const result = matchingRules.length > 0 ? matchingRules[0] : null;
    logger(
      'debug',
      `[findRuleForEntry] Result for "${entryName}": ${result ? `${result.name} (priority ${result.priority})` : 'none'}`,
    );
    return result;
  };

  // =================================================================================
  // --- CORRECTED selectBestTarget FUNCTION ---
  // =================================================================================
  const selectBestTarget = (globalState) => {
    const { targetingList, target: currentTarget } = globalState.targeting;
    const battleListEntries = sabStateManager.getBattleList();
    const creatures = sabStateManager.getCreatures();

    logger(
      'debug',
      `[selectBestTarget] targetingList length: ${targetingList?.length || 0}, battleList length: ${battleListEntries?.length || 0}`,
    );

    if (!targetingList?.length || !battleListEntries?.length) {
      logger(
        'debug',
        '[selectBestTarget] No targeting list or battle list entries, returning null',
      );
      return null;
    }

    // Step 1: Correctly identify the current target and its effective priority.
    let currentEffectivePriority = -1;
    let currentTargetRule = null;
    if (currentTarget && currentTarget.name) {
      // Find the full creature object to check if it's reachable.
      const currentTargetDetails = creatures.find(
        (c) => c.instanceId === currentTarget.instanceId,
      );
      if (currentTargetDetails && currentTargetDetails.isReachable) {
        const rule = findRuleForEntry(currentTarget.name, targetingList);
        if (rule) {
          currentEffectivePriority = rule.priority + rule.stickiness;
          currentTargetRule = rule;
        }
      }
    }

    // Step 2: Find the best available alternative from the battle list.
    let bestAlternative = null;
    let bestAlternativePriority = -1;
    logger(
      'debug',
      `[selectBestTarget] Scanning battle list entries: ${battleListEntries.map((e) => e.name).join(', ')}`,
    );

    for (const entry of battleListEntries) {
      // Skip if this entry is our current target
      if (
        currentTarget &&
        currentTarget.name &&
        entry.name === currentTarget.name
      ) {
        logger(
          'debug',
          `[selectBestTarget] Skipping current target: ${entry.name}`,
        );
        continue;
      }

      const rule = findRuleForEntry(entry.name, targetingList);
      logger(
        'debug',
        `[selectBestTarget] Entry: ${entry.name}, Rule found: ${rule ? `${rule.name} (priority ${rule.priority})` : 'none'}`,
      );

      if (rule && rule.priority > bestAlternativePriority) {
        bestAlternativePriority = rule.priority;
        bestAlternative = { name: entry.name, rule };
        logger(
          'debug',
          `[selectBestTarget] New best alternative: ${entry.name} with priority ${rule.priority}`,
        );
      }
    }

    // Step 3: Make the decision.
    logger(
      'debug',
      `[selectBestTarget] Decision: bestAlternative=${bestAlternative?.name}, bestPriority=${bestAlternativePriority}, currentEffective=${currentEffectivePriority}`,
    );

    if (bestAlternative && bestAlternativePriority > currentEffectivePriority) {
      // A better target exists, so we must switch.
      logger(
        'info',
        `[selectBestTarget] Switching to better target: ${bestAlternative.name}`,
      );
      return bestAlternative;
    }

    if (currentTargetRule) {
      // No better target exists, and our current target is valid, so stick to it.
      logger(
        'debug',
        `[selectBestTarget] Sticking with current target: ${currentTarget.name}`,
      );
      return { name: currentTarget.name, rule: currentTargetRule };
    }

    // Our current target is invalid (unreachable, etc.), so fall back to the best alternative.
    logger(
      'debug',
      `[selectBestTarget] Falling back to best alternative: ${bestAlternative?.name || 'none'}`,
    );
    return bestAlternative;
  };

  const isDesiredTargetAcquired = (desiredRuleName, globalState) => {
    const currentTarget = globalState.targeting.target;
    if (!currentTarget || !currentTarget.name) return false;

    const targetedName = currentTarget.name;

    // Exact match
    if (targetedName === desiredRuleName) return true;

    // Handle truncated names: if targeted name ends with "..." check if desired name starts with the truncated part
    if (targetedName.endsWith('...')) {
      const truncatedPart = targetedName.slice(0, -3);
      return desiredRuleName.startsWith(truncatedPart);
    }

    return false;
  };

  const manageTargetAcquisition = async (
    targetingContext,
    globalState,
    pathfindingTarget,
  ) => {
    if (!pathfindingTarget) {
      logger(
        'debug',
        '[manageTargetAcquisition] No pathfinding target, returning',
      );
      return;
    }

    const isAlreadyAcquired = isDesiredTargetAcquired(
      pathfindingTarget.rule.name,
      globalState,
    );
    logger(
      'debug',
      `[manageTargetAcquisition] Target: ${pathfindingTarget.name}, Rule: ${pathfindingTarget.rule.name}, Already acquired: ${isAlreadyAcquired}`,
    );

    if (isAlreadyAcquired) {
      logger(
        'debug',
        '[manageTargetAcquisition] Target already acquired, returning',
      );
      return;
    }
    const now = Date.now();
    if (now - targetingContext.lastClickTime < TARGET_CLICK_DELAY_MS) return;
    const battleList = globalState.battleList.entries;
    const currentIndex = battleList.findIndex(
      (e) =>
        globalState.targeting.target &&
        e.name === globalState.targeting.target.name,
    );
    let bestKeyPlan = { action: null, presses: Infinity };
    const potentialIndices = battleList
      .map((e, i) => i)
      .filter((i) => {
        const battleListName = battleList[i].name;
        const ruleName = pathfindingTarget.rule.name;

        // Exact match
        if (battleListName === ruleName) return true;

        // Handle truncated names: if battle list name ends with "..." check if rule name starts with the truncated part
        if (battleListName.endsWith('...')) {
          const truncatedPart = battleListName.slice(0, -3);
          return ruleName.startsWith(truncatedPart);
        }

        return false;
      });

    logger(
      'debug',
      `[manageTargetAcquisition] Battle list: ${battleList.map((e, i) => `${i}:${e.name}`).join(', ')}`,
    );
    logger(
      'debug',
      `[manageTargetAcquisition] Current index: ${currentIndex}, Potential indices: ${potentialIndices.join(', ')}`,
    );
    logger(
      'debug',
      `[manageTargetAcquisition] Looking for rule: ${pathfindingTarget.rule.name}`,
    );
    if (potentialIndices.length > 0) {
      for (const desiredIndex of potentialIndices) {
        let tabs, graves;
        if (currentIndex === -1) {
          // When no target is selected, we need to press tab (desiredIndex + 1) times
          // to reach the desired target (0-based index becomes 1-based for key presses)
          tabs = desiredIndex + 1;
          // For graves, we'd need to go backwards from the end
          graves = battleList.length - desiredIndex;
        } else {
          // Calculate forward distance (tabs)
          tabs =
            (desiredIndex - currentIndex + battleList.length) %
            battleList.length;
          if (tabs === 0) tabs = battleList.length; // Full circle

          // Calculate backward distance (graves)
          graves =
            (currentIndex - desiredIndex + battleList.length) %
            battleList.length;
          if (graves === 0) graves = battleList.length; // Full circle
        }

        logger(
          'debug',
          `[manageTargetAcquisition] For desiredIndex ${desiredIndex}: tabs=${tabs}, graves=${graves}`,
        );

        // When currentIndex is -1, prefer tabs since it's more intuitive
        // Only consider reasonable distances (prevent excessive key presses)
        if (tabs > 0 && tabs <= 20 && tabs < bestKeyPlan.presses) {
          bestKeyPlan = { action: 'tab', presses: tabs };
          logger(
            'debug',
            `[manageTargetAcquisition] New best plan: ${tabs} tabs`,
          );
        }
        // Only consider graves if it's significantly better than tabs
        if (graves > 0 && graves <= 20 && graves < bestKeyPlan.presses - 2) {
          bestKeyPlan = { action: 'grave', presses: graves };
          logger(
            'debug',
            `[manageTargetAcquisition] New best plan: ${graves} graves`,
          );
        }
      }
    } else {
      logger(
        'warn',
        '[manageTargetAcquisition] No potential indices found for targeting',
      );
    }
    logger(
      'debug',
      `[manageTargetAcquisition] Final key plan: action=${bestKeyPlan.action}, presses=${bestKeyPlan.presses}`,
    );

    if (
      bestKeyPlan.action &&
      bestKeyPlan.presses < Infinity &&
      bestKeyPlan.presses <= 10
    ) {
      const key = bestKeyPlan.action === 'tab' ? 'tab' : 'grave';
      logger(
        'info',
        `[manageTargetAcquisition] Pressing ${key} ${bestKeyPlan.presses} times to acquire ${pathfindingTarget.name}`,
      );

      for (let i = 0; i < bestKeyPlan.presses; i++) {
        postInputAction('hotkey', {
          module: 'keypress',
          method: 'sendKey',
          args: [key, null],
        });
        targetingContext.lastClickTime = now;
        targetingContext.acquisitionUnlockTime =
          now + TARGET_CONFIRMATION_TIMEOUT_MS + 50;

        // Small delay between key presses to prevent overwhelming the game
        await delay(50);

        const pollStartTime = Date.now();
        let acquired = false;
        while (Date.now() - pollStartTime < TARGET_CONFIRMATION_TIMEOUT_MS) {
          if (
            isDesiredTargetAcquired(pathfindingTarget.rule.name, globalState)
          ) {
            acquired = true;
            break;
          }
          await delay(CLICK_POLL_INTERVAL_MS);
        }
        if (acquired) {
          logger(
            'info',
            `[manageTargetAcquisition] Successfully acquired target: ${pathfindingTarget.name}`,
          );
          return;
        }
      }
      logger(
        'warn',
        `[manageTargetAcquisition] Failed to acquire target after ${bestKeyPlan.presses} key presses`,
      );
    } else {
      logger(
        'warn',
        `[manageTargetAcquisition] No valid key plan found for target: ${pathfindingTarget.name}`,
      );
    }
  };

  const updateDynamicTarget = (globalState) => {
    const { targetingList, target: currentTarget } = globalState.targeting;
    if (!currentTarget || !currentTarget.name || !currentTarget.isReachable) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      return;
    }
    const rule = findRuleForEntry(currentTarget.name, targetingList);
    if (!rule) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      return;
    }
    const dynamicGoal = {
      stance: rule.stance || 'Follow',
      distance: rule.distance || 1,
      targetCreaturePos: currentTarget.gameCoordinates,
      targetInstanceId: currentTarget.instanceId,
    };
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setDynamicTarget',
      payload: dynamicGoal,
    });
  };

  const manageMovement = async (
    targetingContext,
    globalState,
    path,
    pathfindingStatus,
    playerMinimapPosition,
  ) => {
    const { target: currentTarget } = globalState.targeting;
    const creatures = sabStateManager.getCreatures();
    if (!currentTarget || !currentTarget.name) return;
    if (sabStateManager.isLootingRequired()) return;
    const currentTargetCreature = creatures.find(
      (c) => c.instanceId === currentTarget.instanceId,
    );
    if (currentTargetCreature && currentTargetCreature.isAdjacent) {
      return;
    }
    const rule = findRuleForEntry(
      currentTarget.name,
      globalState.targeting.targetingList,
    );
    if (!rule) return;
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
      pathfindingStatus !== 1 ||
      path.length < 2 ||
      now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS ||
      rule.stance === 'Stand'
    ) {
      return;
    }
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
        /* Movement failed, loop will retry */
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
