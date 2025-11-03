# Deadlock Analysis & Fixes

## Critical Issues Found

### 1. FSM EVALUATING_WAYPOINT Infinite Loop (CRITICAL)
**File:** `electron/workers/cavebot/fsm.js:65-76`

**Problem:**
- Timeout logic resets timer and stays in same state
- `shouldRequestNewPath` flag is never consumed by pathfinder
- If path never arrives, FSM loops forever at 5-second intervals

**Current Code:**
```javascript
if (timeInState > 5000) {
  workerState.shouldRequestNewPath = true; // NEVER READ!
  workerState.evaluatingWaypointSince = now; // Reset timer
  return 'EVALUATING_WAYPOINT'; // STUCK HERE
}
```

**Fix:** Force state transition after timeout
```javascript
if (timeInState > 5000) {
  logger('error', `[FSM] EVALUATING_WAYPOINT timeout - skipping waypoint ${waypointIndex + 1}`);
  await advanceToNextWaypoint(workerState, config, { skipCurrent: true });
  return 'IDLE';
}
```

---

### 2. Movement Lock Not Cleared on Unhandled Errors
**Files:** 
- `electron/workers/cavebot/actionHandlers.js:67-78`
- `electron/workers/targeting/targetingLogic.js:419-441`

**Problem:**
- Lock set before await
- If unexpected error (not timeout), catch block might not execute
- Worker permanently blocked with `isWaitingForMovement = true`

**Fix:** Add finally block
```javascript
workerState.isWaitingForMovement = true;
workerState.movementWaitUntil = Date.now() + timeout;

try {
  await awaitWalkConfirmation(workerState, config, timeout);
} catch (error) {
  // Handle timeout
} finally {
  workerState.isWaitingForMovement = false; // ALWAYS clear
}
```

---

### 3. Control State Ping-Pong Race
**File:** `electron/workers/targetingWorker.js:1597-1633`

**Problem:**
- Request and release control can both trigger in same tick
- If creature dies between checks, causes rapid control cycling
- Example: creature becomes unreachable right after requesting control

**Fix:** Add cooldown timer
```javascript
// Add to targetingState
lastControlChangeTime: 0,
CONTROL_CHANGE_COOLDOWN_MS: 250,

// Before requesting control
const now = Date.now();
if (now - targetingState.lastControlChangeTime < CONTROL_CHANGE_COOLDOWN_MS) {
  return; // Too soon after last change
}
targetingState.lastControlChangeTime = now;
```

---

### 4. Creature Timestamp Timeout Without Retry
**File:** `electron/workers/cavebot/index.js:463-476`

**Problem:**
- After 500ms timeout, proceeds with stale creature data
- No mechanism to detect if creatureMonitor is stuck
- Could cause pathfinding with wrong obstacle positions

**Fix:** Add creatureMonitor health check
```javascript
if (waitTime > 500) {
  // Check if creatureMonitor is completely stuck (no updates for 5+ seconds)
  if (lastUpdate > 0 && Date.now() - lastUpdate > 5000) {
    logger('error', '[Cavebot] CreatureMonitor appears stuck - requesting restart');
    parentPort.postMessage({ command: 'restartWorker', payload: 'creatureMonitor' });
  }
  workerState.controlHandoverTimestamp = 0;
  postStoreUpdate('cavebot/incrementVersion');
}
```

---

### 5. Pathfinder Silent Failure
**File:** `electron/workers/pathfinder/logic.js:305-314`

**Problem:**
- If pathfinding fails early (no result), just returns silently
- Cavebot waits forever for path that will never come
- No status written to SAB

**Fix:** Always write status to SAB
```javascript
if (targetIdentifier && !result) {
  result = { path: [], reason: 'NO_PATH_FOUND' };
  
  // CRITICAL: Always write failure status to SAB
  const statusCode = PATH_STATUS_NO_PATH_FOUND;
  sabInterface.set('cavebotPathData', {
    waypoints: [],
    length: 0,
    status: statusCode,
    // ... other fields
  });
  
  lastWrittenPathSignature = `${statusCode}:empty`;
}
```

---

## Testing Recommendations

### Test Case 1: Cavebot Stuck After Targeting
1. Enable cavebot + targeting
2. Kill all creatures in area
3. Wait for control handover
4. **Expected:** Cavebot resumes walking within 1 second
5. **Check:** No infinite EVALUATING_WAYPOINT loops

### Test Case 2: Movement Lock Release
1. Create scenario where movement fails unexpectedly
2. Manually throw error in `awaitWalkConfirmation`
3. **Expected:** Lock cleared, bot continues
4. **Check:** `isWaitingForMovement` never stuck at true

### Test Case 3: Control Ping-Pong
1. Creature appears → becomes unreachable quickly
2. **Expected:** Smooth control transition, no rapid cycling
3. **Check:** Control state changes max once per 250ms

### Test Case 4: CreatureMonitor Failure
1. Kill creatureMonitor process manually
2. **Expected:** Automatic restart triggered
3. **Check:** Cavebot doesn't freeze

### Test Case 5: Pathfinder Error Handling
1. Request path to unreachable waypoint
2. **Expected:** Waypoint skipped within 5 seconds
3. **Check:** Status written to SAB, FSM transitions out

---

## Priority Order

1. **Fix #1 (FSM timeout)** - Causes most common deadlock
2. **Fix #2 (movement lock)** - Permanent block if triggered
3. **Fix #5 (pathfinder status)** - Related to Fix #1
4. **Fix #3 (control ping-pong)** - Performance issue, not full deadlock
5. **Fix #4 (creature timeout)** - Rare edge case

---

## Additional Safeguards

### Global Deadlock Detector
Add to `cavebot/index.js` main loop:

```javascript
// Track if FSM is stuck in same state
let stateHistory = [];
const MAX_SAME_STATE_TICKS = 100; // 5 seconds at 50ms/tick

if (workerState.fsmState !== 'IDLE') {
  stateHistory.push(workerState.fsmState);
  if (stateHistory.length > MAX_SAME_STATE_TICKS) {
    stateHistory.shift();
    const allSame = stateHistory.every(s => s === workerState.fsmState);
    if (allSame) {
      logger('error', `[Deadlock Detector] FSM stuck in ${workerState.fsmState} for ${MAX_SAME_STATE_TICKS} ticks - forcing reset`);
      resetInternalState(workerState, fsm);
    }
  }
}
```

### Movement Lock Watchdog
Add to both cavebot and targeting:

```javascript
// In main loop, before FSM execution
if (workerState.isWaitingForMovement) {
  const lockDuration = Date.now() - (workerState.movementLockStartTime || 0);
  if (lockDuration > 2000) { // 2 second watchdog
    logger('error', `[Watchdog] Movement lock held for ${lockDuration}ms - force clearing`);
    workerState.isWaitingForMovement = false;
  }
}
```
