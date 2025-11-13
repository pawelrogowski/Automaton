// electron/workers/targetingWorker.js
// New single-loop, one-action-per-tick targeting worker.
// Design: no explicit FSM; behavior derived each tick from snapshot + runtime.

import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import {
  createWorkerInterface,
  WORKER_IDS,
} from './sabState/index.js';
import {
  selectBestTarget,
  updateDynamicTarget as legacyUpdateDynamicTarget,
  manageMovement,
  findRuleForCreatureName,
} from './targeting/targetingLogic.js';
import { isBattleListMatch } from '../utils/nameMatcher.js';
import { PATH_STATUS_IDLE } from './sabState/schema.js';

const DEBUG = false;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = {
  intervalMs: 50,
  clickThrottleMs: 250,
  unreachableGraceMs: 500,
  verifyWindowMs: 300,
  antiStuckAdjacentMs: 5000,
  controlCooldownMs: 250,
};

function loadConfigFromSAB() {
  if (!sabInterface) return;
  try {
    const cfg = sabInterface.get('targetingWorkerConfig');
    if (!cfg || !cfg.data) return;
    const data = cfg.data;
    if (typeof data.intervalMs === 'number') {
      config.intervalMs = data.intervalMs;
    }
    if (typeof data.clickThrottleMs === 'number') {
      config.clickThrottleMs = data.clickThrottleMs;
    }
    if (typeof data.unreachableGraceMs === 'number') {
      config.unreachableGraceMs = data.unreachableGraceMs;
    }
    if (typeof data.verifyWindowMs === 'number') {
      config.verifyWindowMs = data.verifyWindowMs;
    }
    if (typeof data.antiStuckAdjacentMs === 'number') {
      config.antiStuckAdjacentMs = data.antiStuckAdjacentMs;
    }
    if (typeof data.controlCooldownMs === 'number') {
      config.controlCooldownMs = data.controlCooldownMs;
    }
  } catch (e) {
    // Silent; fall back to defaults
  }
}

// ---------------------------------------------------------------------------
// SAB interface init
// ---------------------------------------------------------------------------

if (!workerData || !workerData.unifiedSAB) {
  throw new Error('[TargetingWorker] unifiedSAB is required');
}

const sabInterface = createWorkerInterface(
  workerData.unifiedSAB,
  WORKER_IDS.TARGETING,
);

// ---------------------------------------------------------------------------
// Runtime state (no explicit FSM modes)
// ---------------------------------------------------------------------------

const runtime = {
  isInitialized: false,
  isShuttingDown: false,
  globalState: null,

  // Movement
  playerMinimapPosition: null,
  path: [],
  pathStatus: PATH_STATUS_IDLE,
  pathWptId: 0,
  pathInstanceId: 0,
  isWaitingForMovement: false,
  movementWaitUntil: 0,

  // Control
  lastControlChangeTime: 0,

  // Targeting
  currentTarget: null, // { instanceId, name, gameCoords, acquiredAt, instanceKey }
  pendingAcquisition: null,
  perNameRotation: Object.create(null),
  unreachableSince: 0,
  lastTargetClickTime: 0,
  lastDispatchedDynamicTargetId: null,
  lastVisitedTile: null,
  stuckTarget: {
    instanceId: null,
    adjacentSince: 0,
    lastHp: null,
  },

  // SAB mirrors
  lastTargetingListHash: null,
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const delay = (ms) =>
  new Promise((resolve) => {
    if (ms <= 0) return resolve();
    setTimeout(resolve, ms);
  });

function logDebug(event, payload) {
  if (!DEBUG) return;
  try {
    // eslint-disable-next-line no-console
    console.log('[TARGETING_WORKER]', event, payload || {});
  } catch (_) {
    // ignore
  }
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Name rotation / blacklist helpers
// ---------------------------------------------------------------------------

function getNameKey(name) {
  return String(name || '').toLowerCase();
}

function getNameState(nameKey) {
  const key = getNameKey(nameKey);
  let st = runtime.perNameRotation[key];
  if (!st) {
    st = {
      pointer: null,
      blacklistIdx: new Set(),
      blacklistY: new Set(),
      lastReset: nowMs(),
    };
    runtime.perNameRotation[key] = st;
  }
  return st;
}

function resetNameState(nameKey) {
  const key = getNameKey(nameKey);
  runtime.perNameRotation[key] = {
    pointer: null,
    blacklistIdx: new Set(),
    blacklistY: new Set(),
    lastReset: nowMs(),
  };
}

function buildCandidatesForName(name, battleList, nameState) {
  if (!Array.isArray(battleList) || !battleList.length || !name) {
    return [];
  }
  const candidates = [];
  for (let i = 0; i < battleList.length; i += 1) {
    const be = battleList[i];
    if (!be || !be.name) continue;
    if (
      isBattleListMatch(name, be.name) ||
      isBattleListMatch(be.name, name)
    ) {
      // index blacklist
      if (nameState.blacklistIdx.has(i)) continue;
      // Y blacklist (±2px)
      if (typeof be.y === 'number' && nameState.blacklistY.size > 0) {
        let skip = false;
        const y = be.y;
        // eslint-disable-next-line no-restricted-syntax
        for (const by of nameState.blacklistY) {
          if (Math.abs(by - y) <= 2) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
      }
      candidates.push(i);
    }
  }
  return candidates;
}

function recordFailureForCandidate(name, idx, y) {
  const st = getNameState(name);
  if (typeof idx === 'number') {
    st.blacklistIdx.add(idx);
  }
  if (typeof y === 'number') {
    try {
      st.blacklistY.add(Math.round(y));
    } catch (_) {
      // ignore
    }
  }
}

function pickNextCandidate(pending, battleList) {
  if (
    !pending ||
    !Array.isArray(pending.candidates) ||
    pending.candidates.length === 0
  ) {
    return null;
  }
  if (!Array.isArray(battleList) || battleList.length === 0) {
    return null;
  }

  let idxPos =
    typeof pending.currentIdx === 'number'
      ? pending.currentIdx
      : 0;
  let safety = pending.candidates.length;
  while (safety > 0) {
    safety -= 1;
    const blIndex = pending.candidates[idxPos];
    if (
      typeof blIndex !== 'number' ||
      blIndex < 0 ||
      blIndex >= battleList.length
    ) {
      idxPos = (idxPos + 1) % pending.candidates.length;
      continue;
    }
    const entry = battleList[blIndex];
    if (!entry || typeof entry.y !== 'number') {
      idxPos = (idxPos + 1) % pending.candidates.length;
      continue;
    }
    const sameIndex =
      typeof pending.lastClickedIndex === 'number' &&
      pending.lastClickedIndex === blIndex;
    const sameRow =
      typeof pending.lastClickedY === 'number' &&
      Math.abs(pending.lastClickedY - entry.y) <= 2;
    if (!sameIndex && !sameRow) {
      pending.currentIdx = idxPos;
      return blIndex;
    }
    idxPos = (idxPos + 1) % pending.candidates.length;
  }
  return null;
}

function startPendingAcquisition(
  desired,
  battleList,
  blVersion,
  nameState,
) {
  if (!desired || !desired.name) return null;
  const candidates = buildCandidatesForName(
    desired.name,
    battleList,
    nameState,
  );
  if (!candidates.length) {
    return null;
  }
  const now = performance.now();
  return {
    requestedName: desired.name,
    requestedInstanceId: desired.instanceId || null,
    candidates,
    currentIdx: 0,
    candidatesVersion: blVersion,
    startedAt: now,
    deadline: now + config.verifyWindowMs,
    blVersion,
    lastClickedIndex: null,
    lastClickedY: null,
  };
}

// ---------------------------------------------------------------------------
// applyAction(action): central one-action executor
// ---------------------------------------------------------------------------

async function applyAction(action, context) {
  if (!action) return;

  switch (action.type) {
    case 'requestControl':
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/requestTargetingControl',
      });
      runtime.lastControlChangeTime = nowMs();
      break;

    case 'confirmControl':
      // Clear cavebotPathData
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
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/confirmTargetingControl',
      });
      runtime.lastControlChangeTime = nowMs();
      break;

    case 'releaseControl':
      // Clear dynamic target in store
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      // Clear SAB dynamicTarget mirror if used externally
      // (no separate key specified; rely on cavebot slice)
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/releaseTargetingControl',
      });
      runtime.lastControlChangeTime = nowMs();
      // Reset local targeting state
      runtime.currentTarget = null;
      runtime.pendingAcquisition = null;
      runtime.perNameRotation = Object.create(null);
      runtime.lastDispatchedDynamicTargetId = null;
      runtime.unreachableSince = 0;
      runtime.lastTargetClickTime = 0;
      runtime.stuckTarget = {
        instanceId: null,
        adjacentSince: 0,
        lastHp: null,
      };
      break;

    case 'clickBattleListEntry': {
      const { x, y } = action;
      if (
        typeof x === 'number' &&
        typeof y === 'number'
      ) {
        parentPort.postMessage({
          type: 'inputAction',
          payload: {
            type: 'targeting',
            action: {
              module: 'mouseController',
              method: 'leftClick',
              args: [x, y],
            },
            ttl: config.intervalMs + 5,
          },
        });
        runtime.lastTargetClickTime = performance.now();
      }
      break;
    }

    case 'sendEscape':
      parentPort.postMessage({
        type: 'inputAction',
        payload: {
          type: 'targeting',
          action: {
            module: 'keypress',
            method: 'sendKey',
            args: ['Escape'],
          },
          ttl: config.intervalMs + 5,
        },
      });
      // Full targeting reset on anti-stuck escape
      runtime.currentTarget = null;
      runtime.pendingAcquisition = null;
      runtime.perNameRotation = Object.create(null);
      runtime.unreachableSince = 0;
      runtime.lastTargetClickTime = 0;
      runtime.lastDispatchedDynamicTargetId = null;
      runtime.stuckTarget = {
        instanceId: null,
        adjacentSince: 0,
        lastHp: null,
      };
      // Clear targeting path data
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
      break;

    case 'updateDynamicTarget': {
      const { target, targetingList } = action;

      // New semantics:
      // - This is the single source of truth for BOTH:
      //   - Redux cavebot.dynamicTarget (for UI/debug)
      //   - SAB.dynamicTarget       (for pathfinder)
      // - It is driven purely by the "best" target chosen by targetingWorker,
      //   not by red-box sabTarget confirmation.
      // - When target is null: immediately clear dynamicTarget everywhere.

      if (!target) {
        // Clear Redux dynamic target
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/setDynamicTarget',
          payload: null,
        });

        // Clear SAB dynamic target
        try {
          sabInterface.set('dynamicTarget', {
            targetCreaturePosX: 0,
            targetCreaturePosY: 0,
            targetCreaturePosZ: 0,
            targetInstanceId: 0,
            stance: 0,
            distance: 0,
            valid: 0,
          });
        } catch (_) {
          // best-effort; pathfinder will treat missing/invalid as no target
        }

        runtime.lastDispatchedDynamicTargetId = null;
        break;
      }

      // target != null: use this best candidate as the authoritative goal.

      // Derive stance/distance from targeting rules
      let stance = 'Follow';
      let distance = 1;
      try {
        if (Array.isArray(targetingList)) {
          const rule = findRuleForCreatureName(target.name, targetingList);
          if (rule) {
            if (typeof rule.stance === 'string') {
              stance = rule.stance;
            } else if (typeof rule.stance === 'number') {
              // numeric stance (legacy) 0=Follow,1=Stand,2=Reach
              stance =
                rule.stance === 1
                  ? 'Stand'
                  : rule.stance === 2
                  ? 'Reach'
                  : 'Follow';
            }
            if (typeof rule.distance === 'number') {
              distance = rule.distance;
            }
          }
        }
      } catch (_) {
        // keep safe defaults
      }

      // Map stance string to SAB enum
      const stanceMap = { Follow: 0, Stand: 1, Reach: 2 };
      const sabStance = stanceMap[stance] ?? 0;

      // Resolve coordinates for this target:
      // 1) Prefer target.gameCoords (from selectBestTarget / normalized creatures)
      // 2) Fallback to target.x/y/z
      // 3) Fallback: resolve from SAB.creatures by instanceId
      let gx = target.gameCoords?.x ?? target.x;
      let gy = target.gameCoords?.y ?? target.y;
      let gz = target.gameCoords?.z ?? target.z;

      if (
        (gx == null || gy == null || gz == null) &&
        typeof target.instanceId === 'number' &&
        target.instanceId > 0 &&
        typeof sabInterface?.get === 'function'
      ) {
        try {
          const creaturesRes = sabInterface.get('creatures');
          const creatures = Array.isArray(creaturesRes?.data)
            ? creaturesRes.data
            : [];
          const fromCreatures = creatures.find(
            (c) => c && c.instanceId === target.instanceId,
          );
          if (
            fromCreatures &&
            typeof fromCreatures.x === 'number' &&
            typeof fromCreatures.y === 'number' &&
            typeof fromCreatures.z === 'number'
          ) {
            gx = gx ?? fromCreatures.x;
            gy = gy ?? fromCreatures.y;
            gz = gz ?? fromCreatures.z;
          }
        } catch (_) {
          // best-effort
        }
      }

      const hasValidCoords =
        typeof gx === 'number' &&
        typeof gy === 'number' &&
        typeof gz === 'number' &&
        !(gx === 0 && gy === 0 && gz === 0);

      const instanceId = target.instanceId ?? 0;
      const valid =
        (instanceId && instanceId > 0) || hasValidCoords ? 1 : 0;

      // 1) Update Redux dynamicTarget for UI/debug
      // This mirrors old legacyUpdateDynamicTarget behavior but is now driven
      // by the same target we use for SAB, avoiding divergence.
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: valid
          ? {
              stance,
              distance,
              targetCreaturePos: hasValidCoords
                ? { x: gx, y: gy, z: gz }
                : null,
              targetInstanceId: instanceId || null,
            }
          : null,
      });

      // 2) Update SAB.dynamicTarget for pathfinder (authoritative goal)
      try {
        sabInterface.set('dynamicTarget', {
          targetCreaturePosX: hasValidCoords ? gx : 0,
          targetCreaturePosY: hasValidCoords ? gy : 0,
          targetCreaturePosZ: hasValidCoords ? gz : 0,
          targetInstanceId: instanceId,
          stance: sabStance,
          distance: typeof distance === 'number' ? distance : 1,
          valid,
        });
      } catch (_) {
        // If SAB write fails, pathfinder falls back to previous state
      }

      runtime.lastDispatchedDynamicTargetId = instanceId || null;
      break;
    }

    case 'clearDynamicTarget':
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      runtime.lastDispatchedDynamicTargetId = null;
      break;

    case 'clearPathData':
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
      runtime.path = [];
      runtime.pathStatus = PATH_STATUS_IDLE;
      runtime.pathInstanceId = 0;
      runtime.pathWptId = 0;
      break;

    case 'addVisitedTile':
      if (action.tile) {
        parentPort.postMessage({
          storeUpdate: true,
          type: 'cavebot/addVisitedTile',
          payload: action.tile,
        });
        runtime.lastVisitedTile = {
          x: action.tile.x,
          y: action.tile.y,
          z: action.tile.z,
        };
      }
      break;

    case 'updateTargetingListSAB':
      if (Array.isArray(action.targetingList)) {
        sabInterface.set(
          'targetingList',
          action.targetingList,
        );
      }
      break;

    case 'callManageMovement': {
      const { targetingList, currentTarget } = action;
      if (!currentTarget) break;
      await manageMovement(
        {
          ...runtime,
          parentPort,
          sabInterface,
        },
        { targetingList: targetingList || [] },
        currentTarget,
      );
      // manageMovement is responsible for updating isWaitingForMovement/movementWaitUntil
      break;
    }

    default:
      break;
  }

  if (context && context.onAfterAction) {
    try {
      context.onAfterAction();
    } catch (_) {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot + runtime refresh helpers
// ---------------------------------------------------------------------------

function refreshMovementFromSAB() {
  try {
    const pos = sabInterface.get('playerPos');
    if (pos && pos.data) {
      const p = pos.data;
      if (
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        typeof p.z === 'number' &&
        (p.x !== 0 || p.y !== 0 || p.z !== 0)
      ) {
        runtime.playerMinimapPosition = p;
      }
    }
  } catch (_) {
    // ignore
  }

  try {
    const res = sabInterface.get('targetingPathData');
    if (res && res.data) {
      const d = res.data;
      runtime.pathStatus =
        typeof d.status === 'number'
          ? d.status
          : PATH_STATUS_IDLE;
      runtime.pathWptId = d.wptId || 0;
      runtime.pathInstanceId = d.instanceId || 0;
      if (Array.isArray(d.waypoints) && d.waypoints.length) {
        runtime.path = d.waypoints;
      } else {
        runtime.path = [];
      }
    }
  } catch (_) {
    // ignore
  }
}

function normalizeCreatures(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => ({
    ...c,
    distance: c.distance / 100,
    gameCoords: {
      x: c.x,
      y: c.y,
      z: c.z,
    },
  }));
}

function normalizeTarget(target) {
  if (!target || target.instanceId === 0) {
    return null;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Tick: decision pipeline (one action max)
// ---------------------------------------------------------------------------

async function tick() {
  if (
    !runtime.isInitialized ||
    !runtime.globalState
  ) {
    return;
  }

  // 1) Build snapshot
  const snapshot = sabInterface.getTargetingSnapshot
    ? sabInterface.getTargetingSnapshot()
    : null;

  // Minimal fallback reads
  refreshMovementFromSAB();

  const globalState = runtime.globalState;
  const targetingList =
    globalState?.targeting?.targetingList || [];
  const controlState =
    globalState?.cavebot?.controlState || null;

  const hasLootingLock =
    snapshot &&
    snapshot.looting &&
    snapshot.looting.required === 1;

  const isTargetingEnabled =
    !!globalState?.targeting?.enabled && !hasLootingLock;

  const creatures = normalizeCreatures(
    snapshot?.creatures || [],
  );
  const battleList = snapshot?.battleList || [];
  const sabTarget = normalizeTarget(
    snapshot?.target || null,
  );
  const cavebotPathData =
    snapshot?.cavebotPathData || null;

  // versionsMatch guard
  if (snapshot && !snapshot.versionsMatch) {
    // Read-only bookkeeping only; no side-effects.
    return;
  }

  const now = nowMs();

  // Derived: hasBlockingCreature
  let hasBlockingCreature = false;
  if (
    cavebotPathData &&
    (cavebotPathData.blockingCreatureX ||
      cavebotPathData.blockingCreatureY)
  ) {
    const bx = cavebotPathData.blockingCreatureX;
    const by = cavebotPathData.blockingCreatureY;
    const bz = cavebotPathData.blockingCreatureZ;
    hasBlockingCreature = creatures.some(
      (c) =>
        c.gameCoords &&
        c.gameCoords.x === bx &&
        c.gameCoords.y === by &&
        c.gameCoords.z === bz,
    );
  }

  // Best target candidate using shared scoring semantics
  const best = selectBestTarget(
    () => creatures,
    targetingList,
    runtime.currentTarget,
    config.unreachableGraceMs,
    sabInterface,
  );
  const hasAnyValidTargetCandidate = !!best;

  // -----------------------------------------------------------------------
  // Maintain SAB mirror of targetingList via hash (side-effect candidate)
  // -----------------------------------------------------------------------
  let targetingListChanged = false;
  if (Array.isArray(targetingList)) {
    const json = JSON.stringify(targetingList);
    if (json !== runtime.lastTargetingListHash) {
      targetingListChanged = true;
    }
  }

  // -----------------------------------------------------------------------
  // Priority 1: Shutdown guard
  // -----------------------------------------------------------------------
  if (runtime.isShuttingDown) {
    return;
  }

  // -----------------------------------------------------------------------
  // Priority 2: Control arbitration
  // -----------------------------------------------------------------------

  const cooldownOk =
    now - runtime.lastControlChangeTime >=
    config.controlCooldownMs;

  // shouldConfirmControl
  if (
    controlState === 'HANDOVER_TO_TARGETING' &&
    cooldownOk
  ) {
    await applyAction(
      { type: 'confirmControl' },
      null,
    );
    return;
  }

  // Helper: BL has candidates for Attack rules or Others
  let blHasCandidates = false;
  if (Array.isArray(battleList) && targetingList.length) {
    const explicitNames = new Set(
      targetingList
        .filter(
          (r) =>
            r &&
            r.action === 'Attack' &&
            r.name &&
            r.name.toLowerCase() !== 'others',
        )
        .map((r) => r.name),
    );
    const hasOthersRule = targetingList.some(
      (r) =>
        r &&
        r.action === 'Attack' &&
        r.name &&
        r.name.toLowerCase() === 'others',
    );
    blHasCandidates = battleList.some((be) => {
      if (!be || !be.name) return false;
      // explicit
      const matchesExplicit = targetingList.some(
        (r) =>
          r &&
          r.action === 'Attack' &&
          r.name &&
          r.name.toLowerCase() !== 'others' &&
          (isBattleListMatch(r.name, be.name) ||
            isBattleListMatch(be.name, r.name)),
      );
      if (matchesExplicit) return true;
      if (hasOthersRule) {
        const hasExplicit = Array.from(explicitNames).some(
          (name) =>
            isBattleListMatch(name, be.name) ||
            isBattleListMatch(be.name, name),
        );
        if (!hasExplicit) return true;
      }
      return false;
    });

    // If blocking creature exists with Attack rule, force candidates true
    if (!blHasCandidates && hasBlockingCreature) {
      const blockingCreatureMatchesRule = creatures.some(
        (c) => {
          if (!c || !c.name) return false;
          const rule = findRuleForCreatureName(
            c.name,
            targetingList,
          );
          return (
            rule &&
            rule.action === 'Attack' &&
            (c.isBlockingPath ||
              (cavebotPathData &&
                c.gameCoords &&
                c.gameCoords.x ===
                  cavebotPathData.blockingCreatureX &&
                c.gameCoords.y ===
                  cavebotPathData.blockingCreatureY &&
                c.gameCoords.z ===
                  cavebotPathData.blockingCreatureZ))
          );
        },
      );
      if (blockingCreatureMatchesRule) {
        blHasCandidates = true;
      }
    }
  }

  const shouldRequestControl =
    // Targeting may only claim control if:
    // - targeting is enabled
    // - currently in CAVEBOT control
    // - no looting lock
    // - cooldown ok
    // - and there is actual targeting work to do (best candidate or blocking creature)
    isTargetingEnabled &&
    controlState === 'CAVEBOT' &&
    !hasLootingLock &&
    cooldownOk &&
    (hasAnyValidTargetCandidate ||
      (hasBlockingCreature && blHasCandidates));

  const shouldReleaseControl =
    // Release control when:
    // - targeting is disabled (immediate yield back)
    // - or no valid target candidates / BL candidates
    controlState === 'TARGETING' &&
    cooldownOk &&
    (!isTargetingEnabled ||
      !hasAnyValidTargetCandidate ||
      !blHasCandidates);

  if (shouldRequestControl) {
    await applyAction(
      { type: 'requestControl' },
      null,
    );
    return;
  }

  if (shouldReleaseControl) {
    await applyAction(
      { type: 'releaseControl' },
      null,
    );
    return;
  }

  // -----------------------------------------------------------------------
  // Priority 3: If not targeting-enabled or not in TARGETING control,
  //             perform soft cleanup at most once.
  // -----------------------------------------------------------------------

  if (
    !isTargetingEnabled ||
    controlState !== 'TARGETING'
  ) {
    // When targeting is not active or does not own control:
    // - Ensure dynamicTarget is cleared once (this drops targetingPathData via pathfinder).
    // - Reset local targeting state.
    if (runtime.lastDispatchedDynamicTargetId !== null) {
      await applyAction(
        { type: 'updateDynamicTarget', target: null, targetingList },
        {
          onAfterAction: () => {
            runtime.currentTarget = null;
            runtime.pendingAcquisition = null;
            runtime.perNameRotation = Object.create(null);
            runtime.unreachableSince = 0;
            runtime.lastTargetClickTime = 0;
            runtime.lastDispatchedDynamicTargetId = null;
          },
        },
      );
      return;
    }
    // Optionally push SAB targetingList update when idle
    if (targetingListChanged) {
      await applyAction(
        {
          type: 'updateTargetingListSAB',
          targetingList,
        },
        {
          onAfterAction: () => {
            runtime.lastTargetingListHash =
              JSON.stringify(targetingList);
          },
        },
      );
    }
    return;
  }

  // At this point: isTargetingEnabled && controlState === 'TARGETING'

  // -----------------------------------------------------------------------
  // Priority 4: Maintain visitedTiles (one action)
  // -----------------------------------------------------------------------

  if (runtime.playerMinimapPosition) {
    const p = runtime.playerMinimapPosition;
    const last = runtime.lastVisitedTile;
    if (
      !last ||
      last.x !== p.x ||
      last.y !== p.y ||
      last.z !== p.z
    ) {
      await applyAction(
        {
          type: 'addVisitedTile',
          tile: { x: p.x, y: p.y, z: p.z },
        },
        null,
      );
      return;
    }
  }

  // -----------------------------------------------------------------------
  // Priority 5: Acquisition / selection
  // -----------------------------------------------------------------------

  const desiredTarget = best || null;

  if (!desiredTarget) {
    // No desired target while TARGETING has control:
    // immediately clear dynamic target so pathfinder drops targetingPathData.
    if (runtime.lastDispatchedDynamicTargetId !== null) {
      await applyAction(
        { type: 'updateDynamicTarget', target: null, targetingList },
        {
          onAfterAction: () => {
            runtime.currentTarget = null;
            runtime.pendingAcquisition = null;
            runtime.perNameRotation = Object.create(null);
            runtime.unreachableSince = 0;
            runtime.lastTargetClickTime = 0;
            runtime.lastDispatchedDynamicTargetId = null;
          },
        },
      );
      return;
    }

    // No dynamic target active; just keep SAB targetingList in sync if needed.
    if (targetingListChanged) {
      await applyAction(
        {
          type: 'updateTargetingListSAB',
          targetingList,
        },
        {
          onAfterAction: () => {
            runtime.lastTargetingListHash =
              JSON.stringify(targetingList);
          },
        },
      );
    }
    return;
  }

  // If we already have coherent currentTarget matching desired, skip to ENGAGE logic.
  if (runtime.currentTarget) {
    const curKey =
      runtime.currentTarget.instanceKey ||
      runtime.currentTarget.instanceId;
    const desiredKey =
      desiredTarget.instanceKey ||
      desiredTarget.instanceId;
    if (
      (curKey && desiredKey && curKey === desiredKey) ||
      isBattleListMatch(
        runtime.currentTarget.name,
        desiredTarget.name,
      )
    ) {
      // ensure dynamic target consistency if needed
      if (
        runtime.lastDispatchedDynamicTargetId !==
        (desiredTarget.instanceId || null)
      ) {
        await applyAction(
          {
            type: 'updateDynamicTarget',
            target: desiredTarget,
            targetingList,
          },
          null,
        );
        return;
      }
      // Already have target; continue pipeline below.
    } else {
      // New desired target; drop pending and prepare reacquisition (no side effect here).
      runtime.pendingAcquisition = null;
      if (runtime.currentTarget.name) {
        resetNameState(runtime.currentTarget.name);
      }
      runtime.currentTarget = null;
    }
  }

  // Immediately publish dynamic target based on desiredTarget.
  // This drives pathfinder + movement independently of red-box.
  await applyAction(
    {
      type: 'updateDynamicTarget',
      target: {
        ...desiredTarget,
        gameCoords:
          desiredTarget.gameCoords ||
          desiredTarget.gameCoordinates,
      },
      targetingList,
    },
    {
      onAfterAction: () => {
        // Track as current logical target for stickiness/anti-stuck.
        runtime.currentTarget = {
          ...desiredTarget,
          gameCoords:
            desiredTarget.gameCoords ||
            desiredTarget.gameCoordinates,
          acquiredAt: now,
          instanceKey:
            desiredTarget.instanceKey ||
            desiredTarget.instanceId,
        };
        // No pending acquisition dance: movement is allowed to follow dynamicTarget
        // immediately; red-box targeting is decoupled from pathfinding.
        runtime.pendingAcquisition = null;
      },
    },
  );

  // Skip legacy ACQUIRE_ATTEMPT/VERIFY; one-action-per-tick loop continues.
  // Remaining priorities (7-9) will operate on runtime.currentTarget
  // and SAB.targetingPathData produced by pathfinder.

  if (runtime.pendingAcquisition) {
    const pending = runtime.pendingAcquisition;
    const highResNow = performance.now();

    // Success: sabTarget matches requested instance or name & reachable
    if (sabTarget) {
      const nameMatches =
        isBattleListMatch(
          pending.requestedName,
          sabTarget.name,
        ) ||
        isBattleListMatch(
          sabTarget.name,
          pending.requestedName,
        );
      const idMatches =
        pending.requestedInstanceId &&
        sabTarget.instanceId ===
          pending.requestedInstanceId;
      if (
        (idMatches || nameMatches) &&
        sabTarget.isReachable
      ) {
        await applyAction(
          {
            type: 'updateDynamicTarget',
            target: sabTarget,
            targetingList,
          },
          {
            onAfterAction: () => {
              runtime.currentTarget = {
                ...sabTarget,
                gameCoords: {
                  x: sabTarget.x,
                  y: sabTarget.y,
                  z: sabTarget.z,
                },
                acquiredAt: now,
                instanceKey:
                  sabTarget.instanceKey ||
                  sabTarget.instanceId,
              };
              resetNameState(
                pending.requestedName,
              );
              runtime.pendingAcquisition = null;
            },
          },
        );
        return;
      }
    }

    // Deadline or mismatch: try rotating BL candidate and clicking
    if (highResNow > pending.deadline) {
      // Record failure for last clicked
      if (
        typeof pending.lastClickedIndex ===
          'number' &&
        battleList[pending.lastClickedIndex]
      ) {
        recordFailureForCandidate(
          pending.requestedName,
          pending.lastClickedIndex,
          battleList[pending.lastClickedIndex].y,
        );
      }

      const nextIndex = pickNextCandidate(
        pending,
        battleList,
      );
      if (
        nextIndex != null &&
        highResNow -
          runtime.lastTargetClickTime >=
          config.clickThrottleMs
      ) {
        const entry = battleList[nextIndex];
        if (
          entry &&
          typeof entry.x === 'number' &&
          typeof entry.y === 'number'
        ) {
          await applyAction(
            {
              type: 'clickBattleListEntry',
              x: entry.x,
              y: entry.y,
            },
            {
              onAfterAction: () => {
                pending.lastClickedIndex =
                  nextIndex;
                pending.lastClickedY = entry.y;
                pending.startedAt = highResNow;
                pending.deadline =
                  highResNow +
                  config.verifyWindowMs;
              },
            },
          );
          return;
        }
      }

      if (nextIndex == null) {
        // No candidates left; drop pending
        runtime.pendingAcquisition = null;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Priority 7: ENGAGE-like behavior for currentTarget
  // -----------------------------------------------------------------------

  if (runtime.currentTarget) {
    const curKey =
      runtime.currentTarget.instanceKey ||
      runtime.currentTarget.instanceId;

    const live = creatures.find(
      (c) =>
        (c.instanceKey || c.instanceId) === curKey,
    );

    // Coherence check
    if (!live || !sabTarget) {
      await applyAction(
        { type: 'clearDynamicTarget' },
        {
          onAfterAction: () => {
            runtime.currentTarget = null;
            runtime.pendingAcquisition = null;
            runtime.unreachableSince = 0;
          },
        },
      );
      return;
    }

    // Possibly retarget if unreachable too long and another candidate exists
    if (!live.isReachable) {
      if (!runtime.unreachableSince) {
        runtime.unreachableSince = now;
      }
      const dur = now - runtime.unreachableSince;
      if (
        dur > config.unreachableGraceMs &&
        best &&
        (best.instanceId ||
          best.instanceKey) !== curKey
      ) {
        // Mark BL row as bad if we can, seed new pending acquisition
        runtime.currentTarget = null;
        runtime.pendingAcquisition = null;
        runtime.unreachableSince = 0;
        const nameState = getNameState(
          best.name,
        );
        const pending = startPendingAcquisition(
          best,
          battleList,
          snapshot?.battleListVersion || 0,
          nameState,
        );
        runtime.pendingAcquisition = pending || null;
        // No side-effect this tick (respect one-action rule).
        return;
      }
    } else {
      runtime.unreachableSince = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Priority 8: Anti-stuck Escape (adjacent bug)
  // -----------------------------------------------------------------------

  if (runtime.currentTarget) {
    const curKey =
      runtime.currentTarget.instanceKey ||
      runtime.currentTarget.instanceId;
    const live = creatures.find(
      (c) =>
        (c.instanceKey || c.instanceId) === curKey,
    );
    if (live && live.isAdjacent) {
      const st = runtime.stuckTarget;
      if (st.instanceId !== live.instanceId) {
        st.instanceId = live.instanceId;
        st.adjacentSince = now;
        st.lastHp = live.hp;
      } else {
        if (live.hp !== st.lastHp) {
          st.lastHp = live.hp;
          st.adjacentSince = now;
        } else {
          const dur =
            now - (st.adjacentSince || now);
          if (
            dur >= config.antiStuckAdjacentMs
          ) {
            await applyAction(
              { type: 'sendEscape' },
              null,
            );
            return;
          }
        }
      }
    } else {
      // reset tracking when not adjacent
      runtime.stuckTarget = {
        instanceId: live
          ? live.instanceId
          : null,
        adjacentSince: 0,
        lastHp: live ? live.hp : null,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Priority 9: Movement via manageMovement (last, single action)
  // -----------------------------------------------------------------------

  if (
    controlState === 'TARGETING' &&
    !hasLootingLock &&
    runtime.currentTarget &&
    (!runtime.isWaitingForMovement ||
      now >= runtime.movementWaitUntil)
  ) {
    // Ensure path is valid, owned by current target, and not stale
    if (
      Array.isArray(runtime.path) &&
      runtime.path.length >= 2 &&
      runtime.pathInstanceId ===
        runtime.currentTarget.instanceId &&
      runtime.playerMinimapPosition
    ) {
      const start = runtime.path[0];
      const cur = runtime.playerMinimapPosition;
      if (
        start &&
        start.x === cur.x &&
        start.y === cur.y &&
        start.z === cur.z
      ) {
        await applyAction(
          {
            type: 'callManageMovement',
            targetingList,
            currentTarget:
              runtime.currentTarget,
          },
          {
            onAfterAction: () => {
              // manageMovement is async and manipulates runtime via workerContext
              // runtime.isWaitingForMovement is already updated there
            },
          },
        );
        return;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Lowest: targetingList SAB mirror if still pending and no higher-priority action used
  // -----------------------------------------------------------------------

  if (targetingListChanged) {
    await applyAction(
      {
        type: 'updateTargetingListSAB',
        targetingList,
      },
      {
        onAfterAction: () => {
          runtime.lastTargetingListHash =
            JSON.stringify(targetingList);
        },
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Main loop (single non-recursive loop, one tick per 50ms)
// ---------------------------------------------------------------------------

async function mainLoop() {
  while (!runtime.isShuttingDown) {
    const start = performance.now();
    try {
      await tick();
    } catch (e) {
      // Soft-fail this tick only
      logDebug('tick_error', {
        message: e.message,
      });
    }
    const elapsed = performance.now() - start;
    const sleepFor = Math.max(
      0,
      config.intervalMs - elapsed,
    );
    if (sleepFor > 0) {
      await delay(sleepFor);
    }
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

parentPort.on('message', (message) => {
  if (!message || runtime.isShuttingDown) {
    return;
  }

  try {
    if (message.type === 'shutdown') {
      runtime.isShuttingDown = true;
      return;
    }

    if (message.type === 'state_diff') {
      if (!runtime.globalState) {
        runtime.globalState = {};
      }
      Object.assign(runtime.globalState, message.payload || {});
      if (message.payload?.workerConfig) {
        loadConfigFromSAB();
      }
      return;
    }

    if (typeof message === 'object' && !message.type) {
      // Initial full state
      runtime.globalState = message;
      if (!runtime.isInitialized) {
        runtime.isInitialized = true;
        loadConfigFromSAB();
        mainLoop().catch(() => {
          // eslint-disable-next-line no-process-exit
          process.exit(1);
        });
      }
    }
  } catch (_) {
    // Silent
  }
});

// Explicit no-op start function retained for parity
function startWorker() {
  if (!workerData) {
    throw new Error('[TargetingWorker] Worker data not provided');
  }
}

startWorker();
