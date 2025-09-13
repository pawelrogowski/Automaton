// /home/feiron/Dokumenty/Automaton/electron/workers/targeting/actions.js
import { createLogger } from '../../utils/logger.js';

const MOVEMENT_COOLDOWN_MS = 50;
const CLICK_POLL_INTERVAL_MS = 5;
const MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS = 400;
const MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS = 750;
const MOVE_CONFIRM_GRACE_DIAGONAL_MS = 150;
const TARGET_CLICK_DELAY_MS = 50;
const TARGET_CONFIRMATION_TIMEOUT_MS = 375;

export function createTargetingActions(workerContext) {
  const { playerPosArray, pathDataArray, parentPort } = workerContext;
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
          playerPosArray && Atomics.load(playerPosArray, 3) > posCounter;
        const pathChanged =
          pathDataArray && Atomics.load(pathDataArray, 4) > pathCounter;
        if (posChanged || pathChanged) {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve(true);
        }
      }, CLICK_POLL_INTERVAL_MS);
    });
  };

  const findRuleForEntry = (entryName, targetingList) => {
    if (!entryName || !targetingList) return null;
    const cleanName = entryName.replace(/\.+$/, '').trim();
    const matchingRules = targetingList
      .filter((r) => r.action === 'Attack' && r.name.startsWith(cleanName))
      .sort((a, b) => b.priority - a.priority);
    return matchingRules.length > 0 ? matchingRules[0] : null;
  };

  const selectBestTarget = (globalState) => {
    const { targetingList, target: currentTarget } = globalState.targeting;
    const battleListEntries = globalState.battleList.entries;
    if (!targetingList?.length || !battleListEntries?.length) return null;
    const currentRule = currentTarget
      ? findRuleForEntry(currentTarget.name, targetingList)
      : null;
    const currentEffectivePriority = currentRule
      ? currentRule.priority + currentRule.stickiness
      : -1;
    let bestAvailableTarget = null;
    let bestAvailablePriority = -1;
    for (const entry of battleListEntries) {
      if (currentTarget && entry.name === currentTarget.name) continue;
      const rule = findRuleForEntry(entry.name, targetingList);
      if (rule && rule.priority > bestAvailablePriority) {
        bestAvailablePriority = rule.priority;
        bestAvailableTarget = { name: entry.name, rule };
      }
    }
    if (bestAvailableTarget && bestAvailablePriority > currentEffectivePriority)
      return bestAvailableTarget;
    if (currentRule) return { name: currentTarget.name, rule: currentRule };
    return bestAvailableTarget;
  };

  const isDesiredTargetAcquired = (desiredRuleName, globalState) => {
    const currentTarget = globalState.targeting.target;
    if (!currentTarget || !currentTarget.name) return false;
    const cleanTargetedName = currentTarget.name.replace(/\.+$/, '').trim();
    return desiredRuleName.startsWith(cleanTargetedName);
  };

  const manageTargetAcquisition = async (
    targetingContext,
    globalState,
    pathfindingTarget,
  ) => {
    if (
      !pathfindingTarget ||
      isDesiredTargetAcquired(pathfindingTarget.rule.name, globalState)
    )
      return;
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
      .filter((i) =>
        pathfindingTarget.rule.name.startsWith(
          battleList[i].name.replace(/\.+$/, '').trim(),
        ),
      );
    if (potentialIndices.length > 0) {
      for (const desiredIndex of potentialIndices) {
        let tabs, graves;
        if (currentIndex === -1) {
          tabs = desiredIndex + 1;
          graves = battleList.length - desiredIndex;
        } else {
          tabs =
            (desiredIndex - currentIndex + battleList.length) %
            battleList.length;
          graves =
            (currentIndex - desiredIndex + battleList.length) %
            battleList.length;
        }
        if (tabs > 0 && tabs < bestKeyPlan.presses)
          bestKeyPlan = { action: 'tab', presses: tabs };
        if (graves > 0 && graves < bestKeyPlan.presses)
          bestKeyPlan = { action: 'grave', presses: graves };
      }
    }
    if (bestKeyPlan.action && bestKeyPlan.presses < Infinity) {
      const key = bestKeyPlan.action === 'tab' ? 'tab' : 'grave';
      for (let i = 0; i < bestKeyPlan.presses; i++) {
        postInputAction('hotkey', {
          module: 'keypress',
          method: 'sendKey',
          args: [key, null],
        });
        targetingContext.lastClickTime = now;
        targetingContext.acquisitionUnlockTime =
          now + TARGET_CONFIRMATION_TIMEOUT_MS + 50;
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
        if (acquired) return;
      }
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
    const { target: currentTarget, creatures } = globalState.targeting;
    if (!currentTarget || !currentTarget.name) return;

    // --- NEW ADJACENCY CHECK ---
    // Find the full creature object from the creatures list to get its `isAdjacent` status.
    const currentTargetCreature = creatures.find(
      (c) => c.instanceId === currentTarget.instanceId,
    );
    if (currentTargetCreature && currentTargetCreature.isAdjacent) {
      return; // Target is adjacent, so we stop all movement.
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
      const posCounter = Atomics.load(playerPosArray, 3);
      const pathCounter = Atomics.load(pathDataArray, 4);
      const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
      const timeout = isDiagonal
        ? MOVE_CONFIRM_TIMEOUT_DIAGONAL_MS
        : MOVE_CONFIRM_TIMEOUT_STRAIGHT_MS;
      postInputAction('targeting', {
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
