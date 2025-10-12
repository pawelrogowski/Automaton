# Targeting Click Spam Fix - December 2024

## Problem Description

The targeting worker was sending multiple rapid targeting clicks (queuing up in inputOrchestrator) when the current target became unreachable due to another creature blocking the path.

### Scenario
1. Player is attacking Creature A
2. Creature B moves between player and Creature A, blocking the path
3. Creature A becomes `isReachable: false`
4. After 400ms timeout, targeting switches to Creature B
5. **BUG**: Multiple clicks for Creature B would queue up in inputOrchestrator

### Root Cause

The targeting worker had a 250ms verification timeout (`acquireTimeoutMs`) that was only enforced in the `VERIFY_ACQUISITION` state. However, when switching targets due to unreachability:

1. `ENGAGING` state detects target unreachable → waits 400ms → transitions to `SELECTING`
2. `SELECTING` immediately picks new target → transitions to `PREPARE_ACQUISITION`
3. `PREPARE_ACQUISITION` validates target → transitions to `PERFORM_ACQUISITION`
4. `PERFORM_ACQUISITION` **immediately sends a click** without checking if 250ms has elapsed since the last click
5. Within the 5ms main loop, if reachability data changed again, the FSM could cycle through states 2-4 multiple times, sending a click each time

**The core issue**: `acquireTimeoutMs` was only used for **verification timeout** logic, not as a **global rate limit** on all targeting clicks.

## Solution

Converted `acquireTimeoutMs` (250ms) into a **global rate limit** that prevents ANY targeting click from being sent more than once per 250ms, regardless of target changes.

### Changes Made

#### 1. Added Global Rate Limiting State
**File**: `electron/workers/targetingWorker.js`

```javascript
// Before
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null,
  currentTarget: null,
  unreachableSince: 0,
  verificationStarted: 0,
  lastDispatchedDynamicTargetId: null,
  lastAcquireAttempt: {
    targetName: '',
    targetInstanceId: null,
  },
};

// After
const targetingState = {
  state: FSM_STATE.IDLE,
  pathfindingTarget: null,
  currentTarget: null,
  unreachableSince: 0,
  lastTargetingClickTime: 0, // NEW: Global rate limiting timestamp
  lastDispatchedDynamicTargetId: null,
  lastAcquireAttempt: {
    targetName: '',
    targetInstanceId: null,
  },
};
```

#### 2. Enforce Rate Limit in PERFORM_ACQUISITION
**File**: `electron/workers/targetingWorker.js` - `handlePerformAcquisitionState()`

```javascript
function handlePerformAcquisitionState() {
  const now = performance.now();
  const { pathfindingTarget } = targetingState;

  // NEW: Enforce global rate limit
  const timeSinceLastClick = now - targetingState.lastTargetingClickTime;
  if (timeSinceLastClick < config.acquireTimeoutMs) {
    logger('debug', `[ACQUIRE] Rate limited: ${timeSinceLastClick.toFixed(0)}ms since last click`);
    return; // Wait before attempting
  }

  const result = acquireTarget(/* ... */);

  if (result.success) {
    targetingState.lastAcquireAttempt.targetInstanceId = pathfindingTarget.instanceId;
    targetingState.lastAcquireAttempt.targetName = pathfindingTarget.name;
    targetingState.lastTargetingClickTime = now; // NEW: Record click time
    logger('debug', `[ACQUIRE] Performed ${result.method} click.`);
    transitionTo(FSM_STATE.VERIFY_ACQUISITION, 'Action performed');
  } else {
    transitionTo(FSM_STATE.SELECTING, `Acquire action failed: ${result.reason}`);
  }
}
```

#### 3. Updated Verification Timeout Logic
**File**: `electron/workers/targetingWorker.js` - `handleVerifyAcquisitionState()`

Now uses `lastTargetingClickTime` instead of `verificationStarted` for consistency:

```javascript
// Before
if (now > targetingState.verificationStarted + config.acquireTimeoutMs) {
  logger('warn', `[ACQUIRE] Timeout waiting for ${targetName}. Retrying action.`);
  transitionTo(FSM_STATE.PREPARE_ACQUISITION, 'Verification timeout');
}

// After
const timeSinceClick = now - targetingState.lastTargetingClickTime;
if (timeSinceClick >= config.acquireTimeoutMs) {
  logger('warn', `[ACQUIRE] Timeout waiting for ${targetName} (${timeSinceClick.toFixed(0)}ms). Retrying action.`);
  transitionTo(FSM_STATE.PREPARE_ACQUISITION, 'Verification timeout');
}
```

#### 4. Updated Configuration Documentation
**File**: `electron/workers/targetingWorker.js`

```javascript
const config = {
  mainLoopIntervalMs: 5,
  unreachableTimeoutMs: 400,
  acquireTimeoutMs: 250, // Global rate limit: minimum time between ANY targeting clicks
  acquisitionGraceTimeMs: 400,
};
```

#### 5. Fixed WARP.md Documentation
**File**: `WARP.md`

Updated input action priority order to match actual implementation in `inputOrchestrator.js`:

```
0: userRule
1: movement
2: looting
3: script
4: targeting
5: hotkey
10: default
```

## Result

- **No more click spam**: Targeting can only send 1 click per 250ms maximum
- **Simpler logic**: Single `acquireTimeoutMs` config value serves both purposes (rate limiting + verification timeout)
- **Handles all scenarios**: Works whether switching targets due to unreachability, death, or priority changes
- **Maintains FSM correctness**: Still goes through proper state transitions, just rate-limited

## Testing

When testing, you should observe:
1. Only 1 targeting click every 250ms in inputOrchestrator logs
2. When creatures become unreachable, the worker will wait 250ms before clicking the new target (if it just clicked)
3. No queuing of multiple targeting clicks in inputOrchestrator

## Related Files

- `electron/workers/targetingWorker.js` - Main targeting FSM logic
- `electron/workers/targeting/targetingLogic.js` - Target selection and acquisition
- `electron/workers/creatureMonitor.js` - Creature reachability detection
- `electron/workers/inputOrchestrator.js` - Input action queue with priority system
- `WARP.md` - Project documentation
