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

const TARGET_CONFIRMATION_TIMEOUT_MS = 750;
const TARGET_ACQUISITION_COOLDOWN_MS = 250;


export function createTargetingActions(workerContext) {
  const { playerPosArray, pathDataArray, parentPort, sabStateManager } =
    workerContext;
  const logger = createLogger({ info: true, error: true, debug: true });

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

  
  
  
  const selectBestTarget = (
    globalState,
    currentPathfindingTarget,
    targetingContext,
  ) => {
    const { targetingList } = globalState.targeting;
    const creatures = sabStateManager.getCreatures();
    const currentTarget = sabStateManager.getCurrentTarget();

    if (!targetingList?.length || !creatures?.length) {
      return { creature: null, rule: null };
    }

    const validCandidates = creatures
      .map((creature) => {
        const rule = findRuleForCreature(creature, targetingList);
        if (!rule) {
          return null;
        }

        if (rule.onlyIfTrapped && !creature.isBlockingPath) {
          return null;
        }

        if (!creature.isReachable) {
          return null;
        }

        
        let score = -rule.priority * 1000;

        
        if (
          currentPathfindingTarget &&
          creature.instanceId === currentPathfindingTarget.instanceId
        ) {
          score -= (rule.stickiness || 0) * 100;
        }

        
        score += creature.distance;

        
        if (creature.isAdjacent) {
          score -= 500;
        }

        return {
          creature,
          rule,
          score,
        };
      })
      .filter(Boolean);

    if (validCandidates.length === 0) {
      if (previousSelectedTargetId !== null) {
        logger('debug', '[selectBestTarget] No valid targets found.');
        previousSelectedTargetId = null;
      }
      return { creature: null, rule: null };
    }

    
    validCandidates.sort((a, b) => a.score - b.score);

    const bestCandidate = validCandidates[0];
    let bestTarget = bestCandidate.creature;
    const bestRule = bestCandidate.rule;

    
    if (
      currentTarget &&
      bestTarget &&
      currentTarget.name === bestTarget.name &&
      currentTarget.instanceId !== bestTarget.instanceId
    ) {
      
      
      const currentTargetDetails = creatures.find(
        (c) => c.instanceId === currentTarget.instanceId,
      );
      if (currentTargetDetails) {
        bestTarget = currentTargetDetails;
      }
    }

    if (bestTarget && bestTarget.instanceId !== previousSelectedTargetId) {
      logger(
        'debug',
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
    const battleList = sabStateManager.getBattleList();
    const creatures = sabStateManager.getCreatures();

    if (!pathfindingTarget) return;

    
    if (
      currentTarget &&
      currentTarget.instanceId === pathfindingTarget.instanceId
    ) {
      return;
    }

    const now = Date.now();
    if (now < targetingContext.acquisitionUnlockTime) return;

    
    let cycleState = targetingContext.ambiguousTargetCycle.get(
      pathfindingTarget.name,
    );
    if (!cycleState) {
      
      cycleState = new Set();
      targetingContext.ambiguousTargetCycle.set(pathfindingTarget.name, cycleState);
    }

    
    let potentialEntries = battleList
      .map((entry, index) => ({ ...entry, index })) 
      .filter(
        (entry) =>
          entry.name === pathfindingTarget.name && !cycleState.has(entry.index),
      );

    if (potentialEntries.length === 0) {
      logger('info', `[manageTargetAcquisition] Exhausted all entries for ${pathfindingTarget.name}. Restarting cycle.`);
      cycleState.clear();
      potentialEntries = battleList
        .map((entry, index) => ({ ...entry, index }))
        .filter(
          (entry) =>
            entry.name === pathfindingTarget.name && !cycleState.has(entry.index),
        );
       if (potentialEntries.length === 0) {
         logger('warn', `[manageTargetAcquisition] No entries found for ${pathfindingTarget.name} even after resetting cycle. Aborting.`);
         return;
       }
    }

    
    let bestUntriedEntry = null;
    if (potentialEntries.length === 1) {
      bestUntriedEntry = potentialEntries[0];
    } else {
      
      let minDistance = Infinity;
      for (const entry of potentialEntries) {
        for (const creature of creatures) {
          if (creature.name === entry.name) {
            const dist = Math.sqrt(
              Math.pow(entry.x - creature.absoluteCoords.x, 2) +
                Math.pow(entry.y - creature.absoluteCoords.y, 2),
            );
            if (dist < minDistance) {
              minDistance = dist;
              bestUntriedEntry = entry;
            }
          }
        }
      }
    }

    if (bestUntriedEntry) {
      cycleState.add(bestUntriedEntry.index); 

      targetingContext.acquisitionUnlockTime =
        now + TARGET_ACQUISITION_COOLDOWN_MS;

      const coordString = `${bestUntriedEntry.x},${bestUntriedEntry.y}`;
      logger(
        'info',
        `[Targeting] Acquiring target: ${pathfindingTarget.name} (ID: ${pathfindingTarget.instanceId}). Best untried entry at index ${bestUntriedEntry.index}. Clicking at {${coordString}}. Cycle state size for name: ${cycleState.size}.`,
      );

      // Get randomized return position in horizontal middle of game world
      const regions = sabStateManager.globalState?.regionCoordinates?.regions;
      let returnPos = null;
      if (regions?.gameWorld) {
        const gw = regions.gameWorld;
        // Horizontal: anywhere in game world with margins
        const marginX = Math.floor(gw.width * 0.1);
        const x = gw.x + marginX + Math.floor(Math.random() * (gw.width - marginX * 2));
        // Vertical: center with ±100px offset
        const centerY = gw.y + Math.floor(gw.height / 2);
        const y = centerY + Math.floor(Math.random() * 201) - 100;
        returnPos = { x, y };
      }
      
      postInputAction('hotkey', {
        module: 'mouseController',
        method: 'leftClick',
        args: [bestUntriedEntry.x, bestUntriedEntry.y, 250, returnPos], // maxDuration: 250ms, return to game world
      });

      
      await awaitTargetConfirmation(
        pathfindingTarget.instanceId,
        TARGET_CONFIRMATION_TIMEOUT_MS,
      );
    }
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
    if (desiredDistance === 1) {
      if (pathfindingTarget.isAdjacent) return;
    } else {
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


export function createAmbiguousAcquirer({ sabStateManager, parentPort, targetingContext, logger }) {
  const LL_DEFAULT_VERIFICATION_TIMEOUT = 300; 
  const LL_DEFAULT_POLL_INTERVAL = 80; 
  const LL_CLICK_GAP_MIN = 30; 
  const LL_CLICK_GAP_JITTER = 20; 
  const LL_INDEX_RETRY_COOLDOWN = 250; 
  const LL_MAX_FULL_CYCLES = 2;
  const LL_FULL_CYCLE_COOLDOWN = 800; 

  function nowMs() { return Date.now(); }
  function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
  function jitter(ms, j) { return ms + Math.floor(Math.random() * j); }

  function defaultVerifyMatch(currentTarget, candidateEntry, targetName, strictMatch, desiredInstanceId) {
    if (!currentTarget) return false;
    if (strictMatch && desiredInstanceId) {
      return currentTarget.instanceId === desiredInstanceId;
    }
    if (candidateEntry && candidateEntry.instanceId && currentTarget.instanceId) {
      return candidateEntry.instanceId === currentTarget.instanceId;
    }
    if (currentTarget.name !== targetName) return false;
    if (candidateEntry && candidateEntry.x != null && candidateEntry.y != null) {
      const dx = Math.abs((currentTarget.x || 0) - (candidateEntry.x || 0));
      const dy = Math.abs((currentTarget.y || 0) - (candidateEntry.y || 0));
      const dz = (currentTarget.z != null && candidateEntry.z != null) ? Math.abs(currentTarget.z - candidateEntry.z) : 0;
      return Math.max(dx, dy, dz) <= 3;
    }
    return true;
  }

  async function attemptAcquireAmbiguousLowLatency(targetName, options = {}) {
    const verificationTimeoutBase = options.verificationTimeoutMs ?? LL_DEFAULT_VERIFICATION_TIMEOUT;
    const pollInterval = options.pollIntervalMs ?? LL_DEFAULT_POLL_INTERVAL;
    const indexRetryCooldown = options.indexRetryCooldownMs ?? LL_INDEX_RETRY_COOLDOWN;
    const maxFullCycles = options.maxFullCycles ?? LL_MAX_FULL_CYCLES;
    const fullCycleCooldown = options.fullCycleCooldownMs ?? LL_FULL_CYCLE_COOLDOWN;
    const strictMatch = !!options.strictMatch;
    const desiredInstanceId = options.desiredInstanceId || null;

    if (!targetingContext._ambiguousMeta) targetingContext._ambiguousMeta = new Map();
    let meta = targetingContext._ambiguousMeta.get(targetName);
    if (!meta) {
      meta = { attempted: new Map(), fullCycles: 0, cooldownUntil: 0 };
      targetingContext._ambiguousMeta.set(targetName, meta);
    }

    
    const latArr = targetingContext._ambigAdaptive?.latencies || [];
    const medianLatency = latArr.length ? latArr.slice().sort((a,b)=>a-b)[Math.floor(latArr.length/2)] : null;
    const adaptiveTimeout = medianLatency ? Math.max(verificationTimeoutBase, Math.ceil(medianLatency * 1.4)) : verificationTimeoutBase;

    if (meta.cooldownUntil && meta.cooldownUntil > nowMs()) {
      return { success: false, reason: 'cooldown_active' };
    }

    function readCandidates() {
      const battleList = sabStateManager.getBattleList() || [];
      const candidates = [];
      for (let i = 0; i < battleList.length; i += 1) {
        const e = battleList[i];
        if (!e) continue;
        if (e.name === targetName) candidates.push({ index: i, entry: e });
      }
      return candidates;
    }

    
    function postClickAtCoords(x, y) {
      // Get randomized return position in horizontal middle of game world
      const regions = sabStateManager.globalState?.regionCoordinates?.regions;
      let returnPos = null;
      if (regions?.gameWorld) {
        const gw = regions.gameWorld;
        // Horizontal: anywhere in game world with margins
        const marginX = Math.floor(gw.width * 0.1);
        const x = gw.x + marginX + Math.floor(Math.random() * (gw.width - marginX * 2));
        // Vertical: center with ±100px offset
        const centerY = gw.y + Math.floor(gw.height / 2);
        const y = centerY + Math.floor(Math.random() * 201) - 100;
        returnPos = { x, y };
      }
      
      parentPort.postMessage({
        type: 'inputAction',
        payload: {
          type: 'targeting',  // FIXED: Use targeting priority, not hotkey
          action: { module: 'mouseController', method: 'leftClick', args: [x, y, 200, returnPos] }, // Return to random game world position
        },
      });
    }

    while (true) {
      const candidates = readCandidates();
      if (!candidates.length) return { success: false, reason: 'no_candidates' };

      
      for (const k of Array.from(meta.attempted.keys())) {
        if (!candidates.some(c => c.index === k)) meta.attempted.delete(k);
      }

      let next = candidates.find(c => !meta.attempted.has(c.index));
      if (!next) {
        
        meta.attempted.clear();
        meta.fullCycles = (meta.fullCycles || 0) + 1;
        if (meta.fullCycles >= maxFullCycles) {
          meta.cooldownUntil = nowMs() + fullCycleCooldown;
          meta.fullCycles = 0;
          logger && logger('debug', `[AmbigAcquirer] Exhausted cycles for ${targetName}, applying short cooldown ${fullCycleCooldown}ms`);
          return { success: false, reason: 'cycles_exhausted' };
        }
        const fresh = readCandidates();
        if (!fresh.length) return { success: false, reason: 'no_candidates_after_clear' };
        next = fresh[0];
      }

      const attemptId = Math.random().toString(36).slice(2,9);
      logger && logger('debug', `[AmbigAcquirer] clicking ${targetName} index=${next.index} attempt=${attemptId}`);

      
      postClickAtCoords(next.entry.x, next.entry.y);

      
      let current = sabStateManager.getCurrentTarget();
      if (defaultVerifyMatch(current, next.entry, targetName, strictMatch, desiredInstanceId)) {
        
        targetingContext._ambigAdaptive.latencies = (targetingContext._ambigAdaptive.latencies || []).slice(-9);
        targetingContext._ambigAdaptive.latencies.push(20);
        meta.fullCycles = 0;
        return { success: true, reason: 'verified_immediate', acquiredCurrentTarget: current };
      }

      
      const start = nowMs();
      let verified = false;
      while (nowMs() - start < adaptiveTimeout) {
        await sleep(pollInterval);
        current = sabStateManager.getCurrentTarget();
        if (defaultVerifyMatch(current, next.entry, targetName, strictMatch, desiredInstanceId)) {
          const latency = nowMs() - start;
          const buf = targetingContext._ambigAdaptive.latencies || [];
          buf.push(latency);
          if (buf.length > 9) buf.shift();
          targetingContext._ambigAdaptive.latencies = buf;
          meta.fullCycles = 0;
          logger && logger('debug', `[AmbigAcquirer] verified ${targetName} at index=${next.index} latency=${latency}ms attempt=${attemptId}`);
          return { success: true, reason: 'verified', acquiredCurrentTarget: current };
        }
      }

      
      meta.attempted.set(next.index, { count: (meta.attempted.get(next.index)?.count || 0) + 1, lastTs: nowMs() });
      logger && logger('debug', `[AmbigAcquirer] verification FAILED for ${targetName} index=${next.index} attempt=${attemptId}`);

      await sleep(indexRetryCooldown);
      await sleep(jitter(LL_CLICK_GAP_MIN, LL_CLICK_GAP_JITTER));
      
    }
  }

  return {
    attemptAcquireAmbiguousLowLatency,
  };
}
