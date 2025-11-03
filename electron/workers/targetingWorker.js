// targetingWorker.js
import { parentPort, workerData } from 'worker_threads';
import { createWorkerInterface, WORKER_IDS } from './sabState/index.js';
import { performance } from 'perf_hooks';

import {
  selectBestTarget,
  updateDynamicTarget,
  getEffectiveScore,
  manageMovement,
  findRuleForCreatureName,
} from './targeting/targetingLogic.js';
import { isBattleListMatch } from '../utils/nameMatcher.js';
import { PATH_STATUS_IDLE } from './sabState/schema.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- FSM States ---
const FSM_STATE = {
  IDLE: 'IDLE',
  SELECTING: 'SELECTING',
  PREPARE_ACQUISITION: 'PREPARE_ACQUISITION',
  PERFORM_ACQUISITION: 'PERFORM_ACQUISITION',
  VERIFY_ACQUISITION: 'VERIFY_ACQUISITION',
  ENGAGING: 'ENGAGING',
};

// --- Configuration - loaded from SAB (synced from Redux) ---
const config = {
  mainLoopIntervalMs: 50,
  unreachableTimeoutMs: 250,
  clickThrottleMs: 250,
  verifyWindowMs: 300,
  antiStuckAdjacentMs: 5000,
};

// Load config from SAB on startup and on config updates
function loadConfigFromSAB() {
  try {
    const result = sabInterface.get('targetingWorkerConfig');
    if (result && result.data) {
      config.mainLoopIntervalMs = result.data.mainLoopIntervalMs ?? 50;
      config.unreachableTimeoutMs = result.data.unreachableTimeoutMs ?? 250;
      config.clickThrottleMs = result.data.clickThrottleMs ?? 250;
      config.verifyWindowMs = result.data.verifyWindowMs ?? 300;
      config.antiStuckAdjacentMs = result.data.antiStuckAdjacentMs ?? 5000;
    }
  } catch (err) {
    // Silent fallback to defaults
  }
}

// --- Worker State (data from other sources) ---
const workerState = {
  globalState: null,
  isInitialized: false,
  isShuttingDown: false,
  playerMinimapPosition: null,
  path: [],
  pathfindingStatus: PATH_STATUS_IDLE,
  pathWptId: 0,
  pathInstanceId: 0,
  isWaitingForMovement: false,
  movementWaitUntil: 0,
};

// --- Targeting FSM State ---
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null, // The creature we WANT to target
  currentTarget: null, // The creature we HAVE targeted
  unreachableSince: 0,
  lastTargetingClickTime: 0, // Timestamp (perf.now()) of last targeting click
  lastDispatchedDynamicTargetId: null,
  acquisitionStartTime: 0,
  lastAcquireAttempt: {
    targetName: '',
    targetInstanceId: null,
  },
  stuckTargetTracking: {
    instanceId: null,
    adjacentSince: 0,
    lastHp: null,
  },
  // Control state change cooldown to prevent ping-pong
  lastControlChangeTime: 0,
  // Tracks per-creature-name candidate rotation and temporary blacklists
  // candidateStateByName: {
  //   [name: string]: { pointer: number|null, blacklist: Set<number>, lastReset: number }
  // }
  candidateStateByName: Object.create(null),
  // pendingClick: null | {
  //   candidates: [indices],
  //   currentCandidateIdx: number,
  //   startedAt: number,
  //   deadline: number,
  //   requestedName: string,
  //   requestedInstanceId: number,
  //   lastTriedCandidateIndex?: number
  // }
  pendingClick: null,
};

// Initialize unified SAB interface
let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(
    workerData.unifiedSAB,
    WORKER_IDS.TARGETING,
  );
} else {
  throw new Error('[TargetingWorker] Unified SAB interface is required');
}

// --- Unified SAB Wrappers ---
const getCreaturesFromSAB = () => {
  try {
    const result = sabInterface.get('creatures');
    if (result && result.data && Array.isArray(result.data)) {
      return result.data.map((creature) => ({
        ...creature,
        distance: creature.distance / 100,
        gameCoords: { x: creature.x, y: creature.y, z: creature.z },
      }));
    }
  } catch (err) {
    // Silent
  }
  return [];
};

const getCurrentTargetFromSAB = () => {
  try {
    const result = sabInterface.get('target');
    if (result && result.data) {
      const target = result.data;
      if (target.instanceId !== 0) {
        return target;
      }
    }
    return null;
  } catch (err) {
    // Silent
  }
  return null;
};

const getBattleListFromSAB = () => {
  try {
    const result = sabInterface.get('battleList');
    if (result && result.data && Array.isArray(result.data)) {
      return result.data;
    }
  } catch (err) {
    // Silent
  }
  return [];
};

// Returns { list: Array, version: number }
const getBattleListSnapshot = () => {
  try {
    const result = sabInterface.get('battleList');
    if (result && result.data && Array.isArray(result.data)) {
      return { list: result.data, version: result.version ?? 0 };
    }
  } catch (err) {
    // Silent
  }
  return { list: [], version: 0 };
};

const isLootingRequired = () => {
  try {
    const result = sabInterface.get('looting');
    if (result && result.data) {
      return result.data.required === 1;
    }
  } catch (err) {
    // Silent
  }
  return false;
};

// --- State Transition Helper ---
function transitionTo(newState) {
  if (targetingState.state === newState) return;
  targetingState.state = newState;

  switch (newState) {
    case FSM_STATE.SELECTING:
      targetingState.pathfindingTarget = null;
      targetingState.currentTarget = null;
      targetingState.stuckTargetTracking.adjacentSince = 0;
      targetingState.stuckTargetTracking.lastHp = null;
      targetingState.stuckTargetTracking.instanceId = null;
      targetingState.pendingClick = null;
      // Clear ALL candidate states to prevent stale pointers across target changes
      targetingState.candidateStateByName = Object.create(null);
      break;
    case FSM_STATE.PREPARE_ACQUISITION:
      targetingState.unreachableSince = 0;
      targetingState.pendingClick = null;
      break;
    case FSM_STATE.VERIFY_ACQUISITION:
      // pendingClick created elsewhere
      break;
    default:
      break;
  }
}

// --- Candidate rotation helpers ---
function getCandidateState(name) {
  const key = String(name || '').toLowerCase();
  if (!targetingState.candidateStateByName[key]) {
    targetingState.candidateStateByName[key] = {
      pointer: null,
      blacklist: new Set(),
      blacklistY: new Set(), // approximate row Ys to avoid re-clicking same visual row after BL shifts
      lastReset: Date.now(),
    };
  }
  return targetingState.candidateStateByName[key];
}

function resetCandidateState(name) {
  const key = String(name || '').toLowerCase();
  targetingState.candidateStateByName[key] = {
    pointer: null,
    blacklist: new Set(),
    blacklistY: new Set(),
    lastReset: Date.now(),
  };
}

function recordFailedCandidate(name, blIndex, blY) {
  const st = getCandidateState(name);
  if (typeof blIndex === 'number') {
    st.blacklist.add(blIndex);
    st.pointer = blIndex; // advance from here next time
  }
  if (typeof blY === 'number') {
    try { st.blacklistY.add(Math.round(blY)); } catch (_) {}
  }
}

function advancePointer(name, blIndex) {
  const st = getCandidateState(name);
  if (typeof blIndex === 'number') st.pointer = blIndex;
}

// Synchronous acquisition status check from SAB `target` struct
function checkAcquisitionStatus(expectedInstanceId, expectedName) {
  const currentTarget = getCurrentTargetFromSAB();

  if (!currentTarget || currentTarget.instanceId === 0) {
    return { status: 'NO_TARGET' };
  }

  if (expectedInstanceId && currentTarget.instanceId === expectedInstanceId) {
    return { status: 'SUCCESS', target: currentTarget };
  }

  if (currentTarget.name === expectedName) {
    return { status: 'WRONG_INSTANCE', target: currentTarget };
  }

  return { status: 'OTHER_TARGET', target: currentTarget };
}

// --- FSM State Handlers ---

function handleIdleState() {
  if (workerState.globalState?.targeting?.enabled && !isLootingRequired()) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/setControlState',
      payload: 'TARGETING',
    });
    transitionTo(FSM_STATE.SELECTING);
  } else {
    if (targetingState.lastDispatchedDynamicTargetId !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.lastDispatchedDynamicTargetId = null;
    }
    targetingState.pathfindingTarget = null;
  }
}

function handleSelectingState() {
  // Clear any stale pendingClick from prior acquisition attempts
  targetingState.pendingClick = null;
  
  const allCreatures = getCreaturesFromSAB();
  const reachableCreatures = allCreatures.filter((c) => c.isReachable);
  const provider = () =>
    reachableCreatures.length > 0 ? reachableCreatures : allCreatures;

  let bestTarget = selectBestTarget(
    provider,
    workerState.globalState.targeting.targetingList,
    null,
  );

  const sabTarget = getCurrentTargetFromSAB();
  if (bestTarget && sabTarget) {
    const sabEntity = allCreatures.find(
      (c) =>
        c.isReachable &&
        (isBattleListMatch(c.name, sabTarget.name) ||
          isBattleListMatch(sabTarget.name, c.name)),
    );
    if (sabEntity && isBattleListMatch(sabEntity.name, bestTarget.name)) {
      bestTarget = sabEntity;
    }
  }

  const currentSABTarget = getCurrentTargetFromSAB();
  if (currentSABTarget && bestTarget) {
    const currentEntity = allCreatures.find(
      (c) => c.instanceId === currentSABTarget.instanceId,
    );
    if (currentEntity) {
      if (!currentEntity.isReachable) {
        // Do not prefer an unreachable current SAB target
      } else if (bestTarget && bestTarget.isReachable) {
        const currentScore = getEffectiveScore(
          currentEntity,
          workerState.globalState.targeting.targetingList,
          true,
          true,
        );
        const bestScore = getEffectiveScore(
          bestTarget,
          workerState.globalState.targeting.targetingList,
          false,
          bestTarget.isReachable,
        );
        if (currentScore >= bestScore) {
          bestTarget = currentEntity;
        }
      } else {
        // If bestTarget is unreachable while current is reachable, prefer current
        bestTarget = currentEntity;
      }
    }
  }

  if (bestTarget) {
    targetingState.pathfindingTarget = bestTarget;
    if (
      targetingState.lastDispatchedDynamicTargetId !== bestTarget.instanceId
    ) {
      updateDynamicTarget(
        parentPort,
        bestTarget,
        workerState.globalState.targeting.targetingList,
      );
      targetingState.lastDispatchedDynamicTargetId = bestTarget.instanceId;
    }
    transitionTo(FSM_STATE.PREPARE_ACQUISITION);
  } else {
    if (targetingState.lastDispatchedDynamicTargetId !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.lastDispatchedDynamicTargetId = null;
    }
    targetingState.pathfindingTarget = null;
    transitionTo(FSM_STATE.IDLE);
  }
}

function handlePrepareAcquisitionState() {
  const { pathfindingTarget } = targetingState;

  if (!pathfindingTarget) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  const updatedTarget = getCreaturesFromSAB().find(
    (c) => c.instanceId === pathfindingTarget.instanceId,
  );
  if (!updatedTarget) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }
  targetingState.pathfindingTarget = updatedTarget;

  transitionTo(FSM_STATE.PERFORM_ACQUISITION);
}

function chooseNearestMatchingIndex(currentIndex, matches, listLen) {
  const forwardDist = (from, to) => (to - from + listLen) % listLen;
  const backDist = (from, to) => (from - to + listLen) % listLen;

  let bestIdx = matches[0];
  let bestSteps = Math.min(
    forwardDist(currentIndex, bestIdx),
    backDist(currentIndex, bestIdx),
  );
  for (let k = 1; k < matches.length; k++) {
    const idx = matches[k];
    const steps = Math.min(
      forwardDist(currentIndex, idx),
      backDist(currentIndex, idx),
    );
    if (steps < bestSteps) {
      bestIdx = idx;
      bestSteps = steps;
    }
  }
  return bestIdx;
}

async function handlePerformAcquisitionState() {
  const now = performance.now();

  // Enforce click throttle
  if (now - targetingState.lastTargetingClickTime < config.clickThrottleMs) {
    return;
  }

  const { pathfindingTarget } = targetingState;
  if (!pathfindingTarget) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  const { list: battleList, version: blVersion } = getBattleListSnapshot();
  if (!Array.isArray(battleList) || battleList.length === 0) {
    // Clear all candidate states when BL is empty to prevent stale pointers
    targetingState.candidateStateByName = Object.create(null);
    targetingState.pendingClick = null;
    transitionTo(FSM_STATE.SELECTING);
    return;
  }
  const listLen = battleList.length;

  // Build name-matching indices
  const matchingIndicesRaw = [];
  for (let i = 0; i < battleList.length; i++) {
    const be = battleList[i];
    if (!be || !be.name) continue;
    if (
      isBattleListMatch(pathfindingTarget.name, be.name) ||
      isBattleListMatch(be.name, pathfindingTarget.name)
    ) {
      matchingIndicesRaw.push(i);
    }
  }

  if (matchingIndicesRaw.length === 0) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  // Apply per-name blacklist and rotation pointer
  const nameKey = pathfindingTarget.name;
  const nameState = getCandidateState(nameKey);
  const isIndexYBlacklisted = (idx) => {
    const e = battleList[idx];
    if (!e || typeof e.y !== 'number' || !nameState.blacklistY || nameState.blacklistY.size === 0) return false;
    for (const vy of nameState.blacklistY) {
      if (Math.abs(vy - e.y) <= 2) return true;
    }
    return false;
  };
  let matchingIndices = matchingIndicesRaw.filter(
    (i) => !nameState.blacklist.has(i) && !isIndexYBlacklisted(i),
  );
  if (matchingIndices.length === 0) {
    // All candidates for this name are exhausted/blacklisted — do not retry same rows now.
    // Avoids re-clicking the same unreachable battle-list entry.
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  // Determine current selected BL index
  let currentIndex = -1;
  let hasActualSelection = false;
  for (let i = 0; i < battleList.length; i++) {
    if (
      battleList[i] &&
      (battleList[i].isTarget === 1 || battleList[i].isTarget === true)
    ) {
      currentIndex = i;
      hasActualSelection = true;
      break;
    }
  }
  if (currentIndex === -1) currentIndex = 0;

  // Clear stale pointer if out of bounds or not in current matching set
  if (typeof nameState.pointer === 'number') {
    if (nameState.pointer >= listLen || !matchingIndices.includes(nameState.pointer)) {
      nameState.pointer = null;
    }
  }

  // Choose a starting candidate: prefer pointer progression, else topmost among matches
  let bestIdx;
  if (
    typeof nameState.pointer === 'number' &&
    matchingIndices.includes(nameState.pointer)
  ) {
    const pos = matchingIndices.indexOf(nameState.pointer);
    bestIdx = matchingIndices[(pos + 1) % matchingIndices.length];
  } else {
    // After BL shrinks or on first encounter, pick topmost to maintain order
    bestIdx = Math.min(...matchingIndices);
  }

  // Validate bestIdx is in bounds and entry exists
  if (typeof bestIdx !== 'number' || bestIdx < 0 || bestIdx >= listLen) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  const entry = battleList[bestIdx];

  if (!entry || typeof entry.x !== 'number' || typeof entry.y !== 'number') {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  // If SAB already has the desired target AND it's reachable, accept without clicking
  const sabTargetNow = getCurrentTargetFromSAB();
  if (
    sabTargetNow &&
    sabTargetNow.isReachable &&
    (sabTargetNow.instanceId === pathfindingTarget.instanceId ||
      isBattleListMatch(sabTargetNow.name, pathfindingTarget.name) ||
      isBattleListMatch(pathfindingTarget.name, sabTargetNow.name))
  ) {
    acceptAcquiredTarget(sabTargetNow);
    return;
  }

  // Create pendingClick with candidate indices; avoid clicking if already selected
  targetingState.pendingClick = {
    candidates: matchingIndices.slice(),
    currentCandidateIdx: matchingIndices.indexOf(bestIdx),
    startedAt: now,
    deadline: now + config.verifyWindowMs,
    requestedName: pathfindingTarget.name,
    requestedInstanceId: pathfindingTarget.instanceId,
    lastTriedCandidateIndex: undefined,
    lastClickedIndex: undefined,
    lastClickedY: undefined,
    blVersion: blVersion,
  };

  // If current selection already matches requested name but SAB target is absent or unreachable,
  // cycle to next matching candidate and click it to search for a reachable instance.
  if (hasActualSelection && targetingState.pendingClick.candidates.includes(currentIndex)) {
    const sabNow = getCurrentTargetFromSAB();
    const desiredName = pathfindingTarget.name;
    const sabMatchesDesired =
      sabNow &&
      (isBattleListMatch(sabNow.name, desiredName) ||
        isBattleListMatch(desiredName, sabNow.name));
    const sabReachable = !!(sabNow && sabNow.isReachable);

    // If SAB already indicates correct and reachable target, proceed to verification without clicking
    if (sabMatchesDesired && sabReachable) {
      transitionTo(FSM_STATE.VERIFY_ACQUISITION);
      return;
    }

    // Otherwise, advance to the next candidate and click (if throttle permits)
    targetingState.pendingClick.currentCandidateIdx =
      (targetingState.pendingClick.currentCandidateIdx + 1) %
      targetingState.pendingClick.candidates.length;
    targetingState.pendingClick.startedAt = now;
    targetingState.pendingClick.deadline = now + config.verifyWindowMs;

    if (now - targetingState.lastTargetingClickTime >= config.clickThrottleMs) {
      // Try to click the next different candidate (skip already-selected rows)
      if (clickNextAvailableCandidate(targetingState.pendingClick, battleList, pathfindingTarget.name)) {
        const idx = targetingState.pendingClick.candidates[targetingState.pendingClick.currentCandidateIdx];
        // Validate idx is in bounds before recording
        if (typeof idx === 'number' && idx >= 0 && idx < battleList.length) {
          targetingState.pendingClick.lastTriedCandidateIndex = idx;
        }
      }
      return;
    }

    // If throttled, fall through to clicking the computed entry below
  }

  // Attempt click via safe helper that avoids clicking the currently selected row
  const didClickPrimary = attemptClickCandidate(bestIdx, battleList);

  if (!didClickPrimary && targetingState.pendingClick) {
    // Try next distinct candidate (skip same index/Y) to avoid toggle loops
    targetingState.pendingClick.currentCandidateIdx =
      (targetingState.pendingClick.currentCandidateIdx + 1) %
      targetingState.pendingClick.candidates.length;
    clickNextAvailableCandidate(
      targetingState.pendingClick,
      battleList,
      pathfindingTarget.name,
    );
  }

  // Bookkeeping after a click (either primary or via next-available)
  if (targetingState.pendingClick) {
    const idx = didClickPrimary
      ? bestIdx
      : targetingState.pendingClick.lastClickedIndex;
    if (typeof idx === 'number' && idx >= 0 && idx < battleList.length) {
      const e2 = battleList[idx];
      targetingState.pendingClick.lastClickedY =
        e2 && typeof e2.y === 'number' ? e2.y : undefined;
      try { advancePointer(pathfindingTarget.name, idx); } catch (_) {}
    }
  }

  targetingState.lastAcquireAttempt.targetInstanceId =
    pathfindingTarget.instanceId;
  targetingState.lastAcquireAttempt.targetName = pathfindingTarget.name;
  if (targetingState.pendingClick) {
    targetingState.pendingClick.lastTriedCandidateIndex = bestIdx;
  }

  transitionTo(FSM_STATE.VERIFY_ACQUISITION);
}

function attemptClickCandidate(candidateIdx, battleList) {
  if (!battleList || !Array.isArray(battleList)) return false;
  if (typeof candidateIdx !== 'number' || candidateIdx < 0 || candidateIdx >= battleList.length) return false;
  const entry = battleList[candidateIdx];
  if (!entry || typeof entry.x !== 'number' || typeof entry.y !== 'number')
    return false;

  // If this candidate is already the selected battle-list entry, avoid clicking to prevent toggle
  let currentSelected = -1;
  for (let i = 0; i < battleList.length; i++) {
    const be = battleList[i];
    if (be && (be.isTarget === 1 || be.isTarget === true)) {
      currentSelected = i;
      break;
    }
  }
  if (currentSelected === candidateIdx) {
    return false;
  }

  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'targeting',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: [entry.x, entry.y],
      },
      ttl: 55,
    },
  });
  targetingState.lastTargetingClickTime = performance.now();
  if (targetingState.pendingClick) {
    targetingState.pendingClick.lastTriedCandidateIndex = candidateIdx;
  }
  return true;
}

function blElemYEquals(entry, y) {
  if (!entry || typeof y !== 'number') return false;
  if (typeof entry.y !== 'number') return false;
  // Treat the same visual row as equal even if the BL shifted up/down by one slot (≈22px)
  const dy = Math.abs(entry.y - y);
  const ROW_PITCH = 22;
  return dy <= 2 || Math.abs(entry.y - (y - ROW_PITCH)) <= 2 || Math.abs(entry.y - (y + ROW_PITCH)) <= 2;
}

function pickNextDistinctCandidateIndex(pending, battleList) {
  if (!pending || !Array.isArray(pending.candidates) || pending.candidates.length === 0) {
    return pending?.currentCandidateIdx ?? 0;
  }
  if (!battleList || !Array.isArray(battleList)) return pending.currentCandidateIdx ?? 0;
  
  let idx = pending.currentCandidateIdx ?? 0;
  let safety = pending.candidates.length;
  while (safety-- > 0) {
    const candIdx = pending.candidates[idx];
    // Skip out-of-bounds candidates entirely
    if (typeof candIdx !== 'number' || candIdx < 0 || candIdx >= battleList.length) {
      idx = (idx + 1) % pending.candidates.length;
      continue;
    }
    const sameIndex = typeof pending.lastClickedIndex === 'number' && pending.lastClickedIndex === candIdx;
    const sameY = typeof pending.lastClickedY === 'number' && blElemYEquals(battleList[candIdx], pending.lastClickedY);
    if (!sameIndex && !sameY) break;
    idx = (idx + 1) % pending.candidates.length;
  }
  return idx;
}

function clickNextAvailableCandidate(pending, battleList, requestedName) {
  if (!pending || !Array.isArray(pending.candidates) || pending.candidates.length === 0) return false;
  if (!battleList || !Array.isArray(battleList)) return false;
  let attempts = pending.candidates.length;
  while (attempts-- > 0) {
    pending.currentCandidateIdx = pickNextDistinctCandidateIndex(pending, battleList);
    const candidateIndex = pending.candidates[pending.currentCandidateIdx];
    
    // Skip if candidate index is out of bounds for current battleList
    if (typeof candidateIndex !== 'number' || candidateIndex < 0 || candidateIndex >= battleList.length) {
      pending.currentCandidateIdx = (pending.currentCandidateIdx + 1) % pending.candidates.length;
      continue;
    }

    // Skip candidates whose Y matches blacklistedYs for this name
    const nameState = requestedName ? getCandidateState(requestedName) : null;
    const entry = battleList[candidateIndex];
    if (
      nameState && entry && typeof entry.y === 'number' && nameState.blacklistY && nameState.blacklistY.size > 0
    ) {
      let yIsBlacklisted = false;
      for (const vy of nameState.blacklistY) {
        if (Math.abs(vy - entry.y) <= 2) { yIsBlacklisted = true; break; }
      }
      if (yIsBlacklisted) {
        pending.currentCandidateIdx = (pending.currentCandidateIdx + 1) % pending.candidates.length;
        continue;
      }
    }

    const clicked = attemptClickCandidate(candidateIndex, battleList);
    if (clicked) {
      // Update rotation state and bookkeeping
      if (requestedName) advancePointer(requestedName, candidateIndex);
      pending.lastClickedIndex = candidateIndex;
      const e = battleList[candidateIndex];
      pending.lastClickedY = e && typeof e.y === 'number' ? e.y : undefined;
      return true;
    }
    // Couldn't click (likely already selected) -> move to next candidate
    pending.currentCandidateIdx = (pending.currentCandidateIdx + 1) % pending.candidates.length;
  }
  return false;
}

function acceptAcquiredTarget(targetObj) {
  const creatures = getCreaturesFromSAB();
  const matchedCreature =
    creatures.find((c) => c.instanceId === targetObj.instanceId) || null;

  targetingState.currentTarget = matchedCreature || {
    instanceId: targetObj.instanceId,
    name: targetObj.name,
    gameCoords: { x: targetObj.x, y: targetObj.y, z: targetObj.z },
    isReachable: !!targetObj.isReachable,
  };

  targetingState.currentTarget.acquiredAt = Date.now();
  targetingState.pathfindingTarget = targetingState.currentTarget;

  // Reset candidate rotation for this name on successful acquisition
  try {
    if (targetingState.currentTarget?.name) {
      resetCandidateState(targetingState.currentTarget.name);
    }
  } catch (_) {}

  try {
    updateDynamicTarget(
      parentPort,
      targetingState.currentTarget,
      workerState.globalState.targeting.targetingList,
    );
  } catch (e) {
    // Silent
  }

  targetingState.pendingClick = null;
  transitionTo(FSM_STATE.ENGAGING);
}

function handleVerifyAcquisitionState() {
  const now = performance.now();
  const pending = targetingState.pendingClick;

  if (!pending) {
    const nowTarget = getCurrentTargetFromSAB();
    if (
      nowTarget &&
      nowTarget.instanceId ===
        targetingState.lastAcquireAttempt.targetInstanceId
    ) {
      acceptAcquiredTarget(nowTarget);
      return;
    }
    transitionTo(FSM_STATE.PREPARE_ACQUISITION);
    return;
  }

  // Prefer SAB target if reachable; otherwise allow BL+Creatures reachable fallback
  try {
    const blSnap = getBattleListSnapshot();
    const bl = blSnap.list;

    // If battle list changed since we started, recompute candidate indices safely
    if (pending && typeof pending.blVersion === 'number' && blSnap.version !== pending.blVersion) {
      const nameState = getCandidateState(pending.requestedName);
      // Rebuild candidates for current BL
      const rebuilt = [];
      for (let i = 0; i < bl.length; i++) {
        const be = bl[i];
        if (!be || !be.name) continue;
        if (
          isBattleListMatch(pending.requestedName, be.name) ||
          isBattleListMatch(be.name, pending.requestedName)
        ) {
          // Exclude blacklisted indices and rows with blacklisted Y
          let skip = false;
          if (nameState.blacklist && nameState.blacklist.has(i)) skip = true;
          if (!skip && nameState.blacklistY && nameState.blacklistY.size) {
            for (const vy of nameState.blacklistY) {
              if (typeof be.y === 'number' && Math.abs(vy - be.y) <= 2) { skip = true; break; }
            }
          }
          if (!skip) rebuilt.push(i);
        }
      }
      if (rebuilt.length === 0) {
        // Nothing to try anymore for this name; fall back to SELECTING
        targetingState.pendingClick = null;
        transitionTo(FSM_STATE.SELECTING);
        return;
      }
      pending.candidates = rebuilt;
      pending.currentCandidateIdx = 0;
      pending.blVersion = blSnap.version;
      // Do not reset lastClickedY; we still want to avoid re-clicking the same row visually
    }

    if (Array.isArray(bl) && bl.length > 0) {
      let selectedIdx = -1;
      for (let i = 0; i < bl.length; i++) {
        const be = bl[i];
        if (be && (be.isTarget === 1 || be.isTarget === true)) {
          selectedIdx = i;
          break;
        }
      }
      if (selectedIdx !== -1) {
        const selectedEntry = bl[selectedIdx];
        if (
          selectedEntry &&
          (isBattleListMatch(selectedEntry.name, pending.requestedName) ||
            isBattleListMatch(pending.requestedName, selectedEntry.name))
        ) {
          const sabNow = getCurrentTargetFromSAB();
          const sabMatchesDesired =
            sabNow &&
            (isBattleListMatch(sabNow.name, pending.requestedName) ||
              isBattleListMatch(pending.requestedName, sabNow.name));
          const sabReachable = !!(sabNow && sabNow.isReachable);
          if (sabMatchesDesired && sabReachable) {
            acceptAcquiredTarget(sabNow);
            resetCandidateState(pending.requestedName);
            return;
          }
          // Fallback: if BL selection matches requested name and a reachable creature with that name exists,
          // accept it even if SAB target overlay isn't detected yet.
          try {
            const creatures = getCreaturesFromSAB();
            const candidates = creatures
              .filter((c) =>
                c &&
                c.isReachable &&
                (isBattleListMatch(c.name, pending.requestedName) ||
                  isBattleListMatch(pending.requestedName, c.name)),
              )
              .sort((a, b) => a.distance - b.distance);
            if (candidates.length > 0) {
              const best = candidates[0];
              acceptAcquiredTarget({
                instanceId: best.instanceId,
                name: best.name,
                x: best.x,
                y: best.y,
                z: best.z,
                isReachable: best.isReachable,
              });
              resetCandidateState(pending.requestedName);
              return;
            }
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    // ignore
  }

  const verification = checkAcquisitionStatus(
    pending.requestedInstanceId,
    pending.requestedName,
  );

  if (verification.status === 'SUCCESS') {
    // Do not accept unreachable acquisitions; cycle to next candidate instead
    if (verification.target && verification.target.isReachable) {
      acceptAcquiredTarget(verification.target);
      // Clear rotation/blacklist for this name on success
      resetCandidateState(pending.requestedName);
      return;
    } else {
      // Mark last tried candidate as failed/unreachable for this name
      if (typeof pending.lastTriedCandidateIndex === 'number') {
        const blSnap2 = getBattleListSnapshot();
        const bl2 = blSnap2.list;
        const idx = pending.lastTriedCandidateIndex;
        if (idx >= 0 && idx < bl2.length) {
          const y = bl2[idx] ? bl2[idx].y : undefined;
          recordFailedCandidate(pending.requestedName, idx, y);
        }
      }
      // Advance to next candidate immediately and attempt acquisition
      pending.currentCandidateIdx =
        (pending.currentCandidateIdx + 1) % pending.candidates.length;
      pending.startedAt = now;
      pending.deadline = now + config.verifyWindowMs;

      if (
        now - targetingState.lastTargetingClickTime >=
        config.clickThrottleMs
      ) {
        const battleList = getBattleListFromSAB();
        clickNextAvailableCandidate(pending, battleList, pending.requestedName);
      }
      return;
    }
  }

  if (verification.status === 'WRONG_INSTANCE') {
    const creatures = getCreaturesFromSAB();
    const newTargetCreature = creatures.find(
      (c) => c.instanceId === verification.target.instanceId,
    );
    const desiredName = pending.requestedName;
    const targetingList = workerState.globalState.targeting.targetingList;

    if (newTargetCreature && newTargetCreature.isReachable) {
      const desiredInstanceObj = creatures.find(
        (c) => c.instanceId === pending.requestedInstanceId,
      );
      const desiredReachable = !!(
        desiredInstanceObj && desiredInstanceObj.isReachable
      );
      const desiredScore = getEffectiveScore(
        { name: desiredName, isReachable: desiredReachable },
        targetingList,
        false,
        desiredReachable,
      );
      const newScore = getEffectiveScore(
        newTargetCreature,
        targetingList,
        true,
        true,
      );

      // If BL selection is already aligned with the desired name, accept current selection to avoid toggle churn
      try {
        const bl = getBattleListFromSAB();
        if (Array.isArray(bl) && bl.length > 0) {
          let selectedIdx = -1;
          for (let i = 0; i < bl.length; i++) {
            const be = bl[i];
            if (be && (be.isTarget === 1 || be.isTarget === true)) {
              selectedIdx = i;
              break;
            }
          }
          if (
            selectedIdx !== -1 &&
            bl[selectedIdx] &&
            (isBattleListMatch(bl[selectedIdx].name, desiredName) ||
              isBattleListMatch(desiredName, bl[selectedIdx].name))
          ) {
            acceptAcquiredTarget(verification.target);
            resetCandidateState(pending.requestedName);
            return;
          }
        }
      } catch (e) {
        // ignore BL check
      }

      if (newScore > desiredScore || !desiredReachable) {
        acceptAcquiredTarget(verification.target);
        resetCandidateState(pending.requestedName);
        return;
      } else {
        // Reject alternative: try next candidate when allowed
        // Mark last tried candidate as suboptimal for this name
        if (typeof pending.lastTriedCandidateIndex === 'number') {
          const blSnap3 = getBattleListSnapshot();
          const bl3 = blSnap3.list;
          const idx = pending.lastTriedCandidateIndex;
          if (idx >= 0 && idx < bl3.length) {
            const y = bl3[idx] ? bl3[idx].y : undefined;
            recordFailedCandidate(pending.requestedName, idx, y);
          }
        }
        pending.currentCandidateIdx =
          (pending.currentCandidateIdx + 1) % pending.candidates.length;
        pending.startedAt = now;
        pending.deadline = now + config.verifyWindowMs;

        if (
          now - targetingState.lastTargetingClickTime >=
          config.clickThrottleMs
        ) {
          const battleList = getBattleListFromSAB();
          clickNextAvailableCandidate(pending, battleList, pending.requestedName);
        }
        return;
      }
    } else {
      // Wrong instance unreachable: try next candidate and remember failure
      if (typeof pending.lastTriedCandidateIndex === 'number') {
        const blSnapX = getBattleListSnapshot();
        const blX = blSnapX.list;
        const idx = pending.lastTriedCandidateIndex;
        if (idx >= 0 && idx < blX.length) {
          const y = blX[idx] ? blX[idx].y : undefined;
          recordFailedCandidate(pending.requestedName, idx, y);
        }
      }
      pending.currentCandidateIdx =
        (pending.currentCandidateIdx + 1) % pending.candidates.length;
      pending.startedAt = now;
      pending.deadline = now + config.verifyWindowMs;

      if (
        now - targetingState.lastTargetingClickTime >=
        config.clickThrottleMs
      ) {
        const battleList = getBattleListFromSAB();
        clickNextAvailableCandidate(pending, battleList, pending.requestedName);
      }
      return;
    }
  }

  // NO_TARGET or OTHER_TARGET
  // If SAB target is missing or unreachable for the requested name, proactively cycle now (no deadline wait)
  try {
    const sabNow = getCurrentTargetFromSAB();
    const desiredName = pending.requestedName;
    const sabMatchesDesired =
      sabNow &&
      (isBattleListMatch(sabNow.name, desiredName) ||
        isBattleListMatch(desiredName, sabNow.name));
    const sabReachable = !!(sabNow && sabNow.isReachable);

    if (!sabNow || !sabMatchesDesired || !sabReachable) {
      // Record failure for last tried, then advance
      if (typeof pending.lastTriedCandidateIndex === 'number') {
        const blSnapNow = getBattleListSnapshot();
        const blNow = blSnapNow.list;
        const idx = pending.lastTriedCandidateIndex;
        if (idx >= 0 && idx < blNow.length) {
          const y = blNow[idx] ? blNow[idx].y : undefined;
          recordFailedCandidate(pending.requestedName, idx, y);
        }
      }
      pending.currentCandidateIdx =
        (pending.currentCandidateIdx + 1) % pending.candidates.length;
      pending.startedAt = now;
      pending.deadline = now + config.verifyWindowMs;

      if (
        now - targetingState.lastTargetingClickTime >=
        config.clickThrottleMs
      ) {
        const battleList = getBattleListFromSAB();
        clickNextAvailableCandidate(pending, battleList, pending.requestedName);
      }
      return;
    }
  } catch (e) {
    // If SAB read fails, fall back to deadline-based cycling
  }

  if (now >= pending.deadline) {
    pending.currentCandidateIdx =
      (pending.currentCandidateIdx + 1) % pending.candidates.length;
    pending.startedAt = now;
    pending.deadline = now + config.verifyWindowMs;

    if (now - targetingState.lastTargetingClickTime >= config.clickThrottleMs) {
      const battleList = getBattleListFromSAB();
      clickNextAvailableCandidate(pending, battleList, pending.requestedName);
    }
    return;
  }

  // Still within verification window, do nothing
  return;
}

async function handleEngagingState() {
  const now = Date.now();

  if (workerState.isWaitingForMovement) {
    if (now < workerState.movementWaitUntil) {
      return;
    } else {
      // Watchdog: If lock was held for > 2 seconds, log error
      const lockDuration = now - workerState.movementWaitUntil;
      if (lockDuration > 2000) {
        console.error(
          `[Watchdog] Targeting movement lock stuck for ${lockDuration}ms - force clearing`,
        );
      }
      workerState.isWaitingForMovement = false;
    }
  }

  const creatures = getCreaturesFromSAB();
  const { globalState } = workerState;
  const targetingList = globalState.targeting.targetingList;

  const actualInGameTarget = getCurrentTargetFromSAB();

  let hasMismatch = false;
  if (actualInGameTarget && targetingState.currentTarget) {
    const targetKey =
      actualInGameTarget.instanceKey || actualInGameTarget.instanceId;
    const currentKey =
      targetingState.currentTarget.instanceKey ||
      targetingState.currentTarget.instanceId;
    hasMismatch = targetKey !== currentKey;
  }

  if (!targetingState.currentTarget || !actualInGameTarget || hasMismatch) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  let bestOverallTarget = selectBestTarget(
    () => creatures,
    targetingList,
    targetingState.currentTarget,
    config.unreachableTimeoutMs,
  );
  if (!bestOverallTarget) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  if (
    bestOverallTarget &&
    bestOverallTarget.instanceId !== targetingState.currentTarget.instanceId
  ) {
    const currentEntity = creatures.find(
      (c) => c.instanceId === targetingState.currentTarget.instanceId,
    );
    if (currentEntity && currentEntity.isReachable) {
      const currentScore = getEffectiveScore(
        currentEntity,
        targetingList,
        true,
        true,
      );
      const bestScore = getEffectiveScore(
        bestOverallTarget,
        targetingList,
        false,
        bestOverallTarget.isReachable,
      );
      if (currentScore >= bestScore) {
        // stick
      } else {
        console.log(
          `[TargetSwap] ${currentEntity.name}[${currentEntity.instanceId}] -> ${bestOverallTarget.name}[${bestOverallTarget.instanceId}] - reason: lower priority (current score: ${currentScore}, new score: ${bestScore})`
        );
        targetingState.pathfindingTarget = bestOverallTarget;
        updateDynamicTarget(parentPort, bestOverallTarget, targetingList);
        transitionTo(FSM_STATE.PREPARE_ACQUISITION);
        return;
      }
    } else {
      console.log(
        `[TargetSwap] ${targetingState.currentTarget.name}[${targetingState.currentTarget.instanceId}] -> ${bestOverallTarget.name}[${bestOverallTarget.instanceId}] - reason: old target unreachable`
      );
      targetingState.pathfindingTarget = bestOverallTarget;
      updateDynamicTarget(parentPort, bestOverallTarget, targetingList);
      transitionTo(FSM_STATE.PREPARE_ACQUISITION);
      return;
    }
  }

  const updatedTarget = creatures.find(
    (c) =>
      c.instanceKey === targetingState.currentTarget.instanceKey ||
      c.instanceId === targetingState.currentTarget.instanceId,
  );

  if (!updatedTarget) {
    transitionTo(FSM_STATE.SELECTING);
    return;
  }

  targetingState.currentTarget = updatedTarget;
  targetingState.currentTarget.instanceKey =
    updatedTarget.instanceKey || updatedTarget.instanceId;
  // Do not reset acquiredAt here; keep original acquisition time for reachability grace logic
  targetingState.pathfindingTarget = updatedTarget;

  // If current target is unreachable, track duration before switching
  // Grace period allows fleeing creatures to become reachable again
  // without premature retargeting to other creatures
  if (!updatedTarget.isReachable) {
    // Track when unreachability started
    if (!targetingState.unreachableSince || targetingState.unreachableSince === 0) {
      targetingState.unreachableSince = now;
    }

    const unreachableDuration = now - targetingState.unreachableSince;
    const UNREACHABLE_GRACE_MS = 500; // Grace period for fleeing creatures

    // Only consider switching if unreachable for longer than grace period
    if (unreachableDuration > UNREACHABLE_GRACE_MS) {
      const sameNameReachables = creatures
        .filter(
          (c) =>
            c &&
            c.isReachable &&
            c.instanceId !== updatedTarget.instanceId &&
            c.name &&
            (isBattleListMatch(c.name, updatedTarget.name) ||
              isBattleListMatch(updatedTarget.name, c.name)),
        )
        .sort((a, b) => a.distance - b.distance);

      // Mark the currently selected BL row (if any) as failed for this name to force cycling
      try {
        const bl = getBattleListFromSAB();
        if (Array.isArray(bl) && bl.length > 0) {
          let selectedIdx = -1;
          for (let i = 0; i < bl.length; i++) {
            const be = bl[i];
            if (be && (be.isTarget === 1 || be.isTarget === true)) {
              selectedIdx = i;
              break;
            }
          }
            if (
              selectedIdx !== -1 &&
              bl[selectedIdx] &&
              (isBattleListMatch(bl[selectedIdx].name, updatedTarget.name) ||
                isBattleListMatch(updatedTarget.name, bl[selectedIdx].name))
            ) {
              const y = typeof bl[selectedIdx].y === 'number' ? bl[selectedIdx].y : undefined;
              recordFailedCandidate(updatedTarget.name, selectedIdx, y);
            }
        }
      } catch (_) {}

      if (sameNameReachables.length > 0) {
        const bestAlt = sameNameReachables[0];
        console.log(
          `[TargetSwap] ${updatedTarget.name}[${updatedTarget.instanceId}] -> ${bestAlt.name}[${bestAlt.instanceId}] - reason: old target unreachable, switching to reachable same-name instance`
        );
        targetingState.pathfindingTarget = bestAlt;
        updateDynamicTarget(parentPort, bestAlt, targetingList);
        transitionTo(FSM_STATE.PREPARE_ACQUISITION);
        return;
      }
    }
    // Within grace period or no alternatives - stay on current target
  } else {
    // Target became reachable again - reset unreachable timer
    targetingState.unreachableSince = 0;
  }

  // Battle list shrink or dead-target heuristics: if BL shrank or SAB lost target, expedite reselection
  try {
    const bl = getBattleListFromSAB();
    const blLen = Array.isArray(bl) ? bl.length : 0;
    if (typeof targetingState.prevBattleListLength !== 'number') {
      targetingState.prevBattleListLength = blLen;
    }
    const blShrank = blLen < targetingState.prevBattleListLength;
    targetingState.prevBattleListLength = blLen;
    if (
      blShrank &&
      (!actualInGameTarget || !updatedTarget || !updatedTarget.isReachable)
    ) {
      transitionTo(FSM_STATE.SELECTING);
      return;
    }
  } catch (e) {}

  // Anti-stuck: CONTINUOUSLY adjacent AND targeted for > antiStuckAdjacentMs with no HP change -> send Escape
  // This prevents the game bug where a creature has the red target box but doesn't take damage.
  // Requirements:
  // 1. Same instanceId (same creature) for entire duration
  // 2. Continuously adjacent (no gaps) for entire duration
  // 3. Continuously targeted (verified by being in ENGAGING state) for entire duration
  // 4. No HP change detected during entire duration
  try {
    const nowMs = Date.now();
    const st = targetingState.stuckTargetTracking;
    
    // CRITICAL: Only track when BOTH adjacent AND in ENGAGING state (which means targeted)
    // This ensures we only measure time when the creature SHOULD be taking damage
    if (updatedTarget.isAdjacent) {
      // Check if this is a different creature or first time tracking this creature as adjacent
      if (st.instanceId !== updatedTarget.instanceId) {
        // Different creature: restart tracking from scratch
        st.instanceId = updatedTarget.instanceId;
        st.adjacentSince = nowMs;
        st.lastHp = updatedTarget.hp;
      } else {
        // Same creature that we're already tracking
        
        // If we weren't tracking adjacency yet (adjacentSince === 0), start now
        // This handles the case where the creature was tracked but became non-adjacent and is now adjacent again
        if (!st.adjacentSince || st.adjacentSince === 0) {
          st.adjacentSince = nowMs;
          st.lastHp = updatedTarget.hp;
        } else {
          // We're tracking - check if HP changed (any change means combat is working)
          // HP is a string: "Full"/"High"/"Medium"/"Low"/"Critical"/"Obstructed"
          if (updatedTarget.hp && updatedTarget.hp !== st.lastHp) {
            // HP changed - combat is working, reset the stuck timer
            st.lastHp = updatedTarget.hp;
            st.adjacentSince = nowMs;
          } else {
            // HP hasn't changed - check if we've been stuck long enough
            const adjacentDuration = nowMs - st.adjacentSince;
            
            if (adjacentDuration >= config.antiStuckAdjacentMs) {
              // FIRE ESCAPE: We've been adjacent and targeted for the full duration with no HP change
              console.log(
                `[AntiStuck] Pressing Escape - ${updatedTarget.name}[${updatedTarget.instanceId}] was adjacent+targeted for ${adjacentDuration}ms with no HP change (threshold: ${config.antiStuckAdjacentMs}ms)`
              );
              
              parentPort.postMessage({
                type: 'inputAction',
                payload: {
                  type: 'targeting',
                  action: { module: 'keypress', method: 'sendKey', args: ['Escape'] },
                  ttl: 55,
                },
              });

              // Reset ALL targeting state to force re-acquisition
              targetingState.pendingClick = null;
              targetingState.pathfindingTarget = null;
              targetingState.currentTarget = null;
              targetingState.unreachableSince = 0;
              targetingState.lastTargetingClickTime = 0;
              targetingState.acquisitionStartTime = 0;
              targetingState.lastAcquireAttempt = { targetName: '', targetInstanceId: null };
              targetingState.stuckTargetTracking = { instanceId: null, adjacentSince: 0, lastHp: null };
              workerState.isWaitingForMovement = false;
              workerState.movementWaitUntil = 0;

              // Clear targeting path data to ensure fresh pathing
              if (sabInterface) {
                try {
                  sabInterface.set('targetingPathData', {
                    waypoints: [],
                    length: 0,
                    status: 0,
                    chebyshevDistance: 0,
                    startX: 0,
                    startY: 0,
                    startZ: 0,
                    targetX: 0,
                    targetY: 0,
                    targetZ: 0,
                    blockingCreatureX: 0,
                    blockingCreatureY: 0,
                    blockingCreatureZ: 0,
                    wptId: 0,
                    instanceId: 0,
                  });
                } catch (e) {}
              }

              transitionTo(FSM_STATE.SELECTING);
              return;
            }
          }
        }
      }
    } else {
      // NOT adjacent: Clear adjacency tracking entirely
      // This is CRITICAL - if the creature stops being adjacent, we reset the timer
      // This prevents false positives where creature was far away, then became adjacent
      if (st.instanceId === updatedTarget.instanceId) {
        // Same creature but no longer adjacent - clear the adjacency timer
        // Keep tracking the instanceId so we know it's the same creature
        st.adjacentSince = 0;
        st.lastHp = updatedTarget.hp;
      } else {
        // Different creature and not adjacent - full reset
        st.instanceId = updatedTarget.instanceId;
        st.adjacentSince = 0;
        st.lastHp = updatedTarget.hp;
      }
    }
  } catch (_) {}
}

// --- Main Loop ---

function updateSABData() {
  if (!sabInterface) return;

  try {
    const posResult = sabInterface.get('playerPos');
    if (posResult && posResult.data) {
      const pos = posResult.data;
      if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
        workerState.playerMinimapPosition = pos;
      }
    }

    const pathResult = sabInterface.get('targetingPathData');
    if (pathResult && pathResult.data) {
      const pathData = pathResult.data;

      const PATH_STATUS_PATH_FOUND = 1;
      const isTargetingPath = (pathData.instanceId || 0) > 0;
      const newInstanceId = pathData.instanceId || 0;
      const isNewTarget =
        newInstanceId !== workerState.pathInstanceId && newInstanceId > 0;
      const isValidPath =
        pathData.status === PATH_STATUS_PATH_FOUND &&
        pathData.waypoints &&
        pathData.waypoints.length >= 2;

      if (isNewTarget) {
        workerState.path = [];
        workerState.pathInstanceId = newInstanceId;
      }

      if (isTargetingPath && isValidPath) {
        workerState.path = pathData.waypoints;
        workerState.pathfindingStatus = pathData.status;
        workerState.pathWptId = pathData.wptId || 0;
        workerState.pathInstanceId = newInstanceId;
      }
    }
  } catch (err) {
    // Silent
  }
}

async function performTargeting() {
  updateSABData();

  const { globalState, isInitialized } = workerState;
  if (!isInitialized || !globalState?.targeting) return;

  if (sabInterface) {
    try {
      sabInterface.set('targetingList', globalState.targeting.targetingList);
    } catch (err) {
      // Silent
    }
  }

  if (!globalState.targeting.enabled || isLootingRequired()) {
    transitionTo(FSM_STATE.IDLE);
  }

  const { controlState } = globalState.cavebot;

  if (controlState === 'HANDOVER_TO_TARGETING') {
    if (sabInterface) {
      try {
        sabInterface.set('cavebotPathData', {
          waypoints: [],
          length: 0,
          status: 0,
          chebyshevDistance: 0,
          startX: 0,
          startY: 0,
          startZ: 0,
          targetX: 0,
          targetY: 0,
          targetZ: 0,
          blockingCreatureX: 0,
          blockingCreatureY: 0,
          blockingCreatureZ: 0,
          wptId: 0,
          instanceId: 0,
        });
      } catch (err) {
        // Silent
      }
    }

    parentPort.postMessage({
      storeUpdate: true,
      type: 'cavebot/confirmTargetingControl',
    });
    return;
  }

  if (controlState === 'TARGETING' && workerState.playerMinimapPosition) {
    const currentPos = workerState.playerMinimapPosition;

    if (
      !targetingState.lastDispatchedVisitedTile ||
      targetingState.lastDispatchedVisitedTile.x !== currentPos.x ||
      targetingState.lastDispatchedVisitedTile.y !== currentPos.y ||
      targetingState.lastDispatchedVisitedTile.z !== currentPos.z
    ) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/addVisitedTile',
        payload: currentPos,
      });
      targetingState.lastDispatchedVisitedTile = { ...currentPos };
    }
  }

  switch (targetingState.state) {
    case FSM_STATE.IDLE:
      handleIdleState();
      break;
    case FSM_STATE.SELECTING:
      handleSelectingState();
      break;
    case FSM_STATE.PREPARE_ACQUISITION:
      if (controlState === 'TARGETING') handlePrepareAcquisitionState();
      break;
    case FSM_STATE.PERFORM_ACQUISITION:
      if (controlState === 'TARGETING') handlePerformAcquisitionState();
      break;
    case FSM_STATE.VERIFY_ACQUISITION:
      if (controlState === 'TARGETING') handleVerifyAcquisitionState();
      break;
    case FSM_STATE.ENGAGING:
      if (controlState === 'TARGETING') await handleEngagingState();
      break;
  }

  if (controlState === 'TARGETING' && targetingState.pathfindingTarget) {
    const movementContext = {
      targetingList: globalState.targeting.targetingList,
    };

    await manageMovement(
      {
        ...workerState,
        parentPort,
        sabInterface,
      },
      movementContext,
      targetingState.pathfindingTarget,
    );
  }

  const hasValidTarget =
    targetingState.state === FSM_STATE.PREPARE_ACQUISITION ||
    targetingState.state === FSM_STATE.PERFORM_ACQUISITION ||
    targetingState.state === FSM_STATE.VERIFY_ACQUISITION ||
    targetingState.state === FSM_STATE.ENGAGING;

  const anyValidTargetExists = selectBestTarget(
    getCreaturesFromSAB,
    globalState.targeting.targetingList,
  );

  // Gate targeting control by presence of battle-list candidates that match targetingList (Attack rules)
  const bl = getBattleListFromSAB();
  const blHasCandidates =
    Array.isArray(bl) &&
    bl.some(
      (be) =>
        be &&
        be.name &&
        workerState.globalState?.targeting?.targetingList?.some(
          (rule) =>
            rule &&
            rule.action === 'Attack' &&
            (isBattleListMatch(rule.name, be.name) ||
              isBattleListMatch(be.name, rule.name)),
        ),
    );

  if (hasValidTarget && controlState === 'CAVEBOT' && blHasCandidates) {
    // Cooldown to prevent rapid control ping-pong (250ms minimum between changes)
    const now = Date.now();
    if (now - targetingState.lastControlChangeTime >= 250) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/requestTargetingControl',
      });
      targetingState.lastControlChangeTime = now;
    }
  }

  // If we are in TARGETING control but there are no valid targets remaining,
  // proactively clear targeting state and return control to cavebot.
  // Note: use only anyValidTargetExists as the primary indicator — if none exist,
  // targeting should relinquish control so cavebot can continue its routine.
  if (
    controlState === 'TARGETING' &&
    (!anyValidTargetExists || !blHasCandidates)
  ) {
    // Cooldown to prevent rapid control ping-pong (250ms minimum between changes)
    const now = Date.now();
    if (now - targetingState.lastControlChangeTime >= 250) {
      // Clear any pending click/acquisition state so we don't hold on to targeting locks.
      targetingState.pendingClick = null;
      targetingState.pathfindingTarget = null;
      targetingState.currentTarget = null;

      // Clear any dynamic target stored in redux / cavebot
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });

      // Inform cavebot to take control back
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
      
      targetingState.lastControlChangeTime = now;

      // Ensure FSM reflects idle/selection state
      transitionTo(FSM_STATE.IDLE);
    }
  }
}

async function mainLoop() {
  while (!workerState.isShuttingDown) {
    const loopStart = performance.now();
    try {
      await performTargeting();
    } catch (error) {
      await delay(1000);
    }
    const loopEnd = performance.now();
    const elapsedTime = loopEnd - loopStart;
    const delayTime = Math.max(0, config.mainLoopIntervalMs - elapsedTime);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

// --- Worker Initialization and Message Handling ---

parentPort.on('message', (message) => {
  if (workerState.isShuttingDown) return;
  try {
    if (message.type === 'shutdown') {
      workerState.isShuttingDown = true;
      return;
    } else if (message.type === 'state_diff') {
      if (!workerState.globalState) workerState.globalState = {};
      Object.assign(workerState.globalState, message.payload);
      // Reload config if workerConfig slice changed
      if (message.payload.workerConfig) {
        loadConfigFromSAB();
      }
    } else if (typeof message === 'object' && !message.type) {
      workerState.globalState = message;
      if (!workerState.isInitialized) {
        workerState.isInitialized = true;
        loadConfigFromSAB(); // Load config on initialization
        mainLoop().catch(() => {
          process.exit(1);
        });
      }
    }
  } catch (error) {
    // Silent
  }
});

function startWorker() {
  if (!workerData) {
    throw new Error('[TargetingWorker] Worker data not provided');
  }
}

startWorker();
