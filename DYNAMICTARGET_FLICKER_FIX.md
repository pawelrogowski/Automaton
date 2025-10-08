# DynamicTarget Flickering - Root Cause & Solution

## Problem
The `dynamicTarget` flickers to `null` briefly, causing targeting issues and pathfinding failures.

## Root Cause
The targeting worker clears `dynamicTarget` to `null` during state transitions (e.g., SELECTING state), even when a new target will be set immediately after. This creates a race condition where the pathfinder reads `null` between the clear and the set.

### Current Flow (Broken):
```
1. TargetingWorker enters SELECTING state
2. Sets dynamicTarget = null  ← FLICKER!
3. Finds new target
4. Sets dynamicTarget = {valid target}
5. Pathfinder reads during step 2-4 → gets null → fails
```

## Solution Options

### Option 1: **Atomic Updates (Recommended)** ⭐
Instead of clearing then setting, only update `dynamicTarget` when we have a valid new target.

**Changes needed:**
1. In `targetingWorker.js` transitionTo() - DON'T clear dynamicTarget to null on SELECTING
2. Only update dynamicTarget when we have a confirmed valid target
3. Add a `lastKnownGoodTarget` cache to preserve the last valid state

**Pros:**
- No flickering
- Pathfinder always has valid data
- Simple change

**Cons:**
- Need to track stale targets (mitigated by instanceId checking)

### Option 2: **Graceful Degradation in Pathfinder**
Make pathfinder use cached target when dynamicTarget is temporarily null.

**Changes needed:**
1. Pathfinder caches last valid dynamicTarget
2. On null, uses cached version with reduced confidence
3. Only invalidates cache after timeout (e.g., 500ms)

**Pros:**
- Resilient to temporary nulls
- Works even if targeting worker has bugs

**Cons:**
- More complex
- Could mask real issues

### Option 3: **Versioned Updates**
Add version numbers to dynamicTarget updates and ignore older versions.

**Changes needed:**
1. Each dynamicTarget update includes incrementing version
2. Pathfinder only accepts updates with version > last seen
3. Null updates don't change version

**Pros:**
- Bulletproof against race conditions
- Clear ordering of updates

**Cons:**
- Most complex
- Requires changes in multiple places

## Recommended Implementation: Option 1

### Code Changes

#### 1. targetingWorker.js - Remove premature null setting
```javascript
function transitionTo(newState, reason = '') {
  if (targetingState.state === newState) return;
  logger(
    'debug',
    `[FSM] Transition: ${targetingState.state} -> ${newState}` +
      (reason ? ` (${reason})` : '')
  );
  targetingState.state = newState;

  if (newState === FSM_STATE.SELECTING) {
    targetingState.pathfindingTarget = null;
    targetingState.currentTarget = null;
    // DON'T clear dynamicTarget here! Keep last valid target until we have a new one
    // Only clear if we're truly going idle (no targets available)
  }
  if (newState === FSM_STATE.ACQUIRING) {
    targetingState.lastAcquireAttempt.timestamp = 0;
  }
}
```

#### 2. targetingWorker.js - Clear only when truly idle
```javascript
function handleIdleState() {
  if (
    workerState.globalState?.targeting?.enabled &&
    !sabStateManager.isLootingRequired()
  ) {
    transitionTo(FSM_STATE.SELECTING, 'Targeting enabled');
  } else {
    // Only NOW clear dynamicTarget - when targeting is disabled
    if (targetingState.pathfindingTarget !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.pathfindingTarget = null;
    }
  }
}
```

#### 3. targetingWorker.js - handleSelectingState
```javascript
function handleSelectingState() {
  const bestTarget = selectBestTarget(
    sabStateManager,
    workerState.globalState.targeting.targetingList
  );

  if (bestTarget) {
    targetingState.pathfindingTarget = bestTarget;
    updateDynamicTarget(
      parentPort,
      bestTarget,
      workerState.globalState.targeting.targetingList
    );
    transitionTo(FSM_STATE.ACQUIRING, `Found target: ${bestTarget.name}`);
  } else {
    // No valid targets - NOW we clear dynamicTarget
    if (targetingState.pathfindingTarget !== null) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'cavebot/setDynamicTarget',
        payload: null,
      });
      targetingState.pathfindingTarget = null;
    }
    transitionTo(FSM_STATE.IDLE, 'No valid targets');
  }
}
```

#### 4. pathfinder/logic.js - Add validation with clear logging
```javascript
if (isTargetingMode) {
  // Validate dynamicTarget exists before accessing properties
  if (!cavebot.dynamicTarget || !cavebot.dynamicTarget.targetCreaturePos) {
    logger('warn', `[Pathfinder] Invalid dynamicTarget: ${JSON.stringify(cavebot.dynamicTarget)}`);
    result = { path: [], reason: 'NO_VALID_END' };
  } else {
    // ... existing pathfinding logic
  }
}
```

## Expected Outcome
- No more flickering
- Pathfinder always has valid target when in targeting mode
- Clear logs if null does occur (indicating a real bug)
- Graceful fallback to no path when truly no targets exist
