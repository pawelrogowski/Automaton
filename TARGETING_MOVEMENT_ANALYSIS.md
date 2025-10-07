# Targeting Movement Analysis: Why Targeting Oversteps

## Problem Statement
The targeting worker frequently oversteps tiles during movement, while the cavebot worker moves reliably. This is causing precision issues when following targets.

---

## Architecture Comparison

### **Cavebot Movement (Reliable) - `electron/workers/cavebot/actionHandlers.js`**

#### Movement Flow:
1. **Send keypress** for movement direction
2. **Await confirmation** via `awaitWalkConfirmation()`:
   - Polls `PLAYER_POS_UPDATE_COUNTER_INDEX` from SharedArrayBuffer
   - Polls `PATH_UPDATE_COUNTER_INDEX` from SharedArrayBuffer
   - Waits until **either counter increments** (player moved OR path updated)
   - Poll interval: `config.stateChangePollIntervalMs` (typically 5ms)
   - Timeout: `config.moveConfirmTimeoutMs` (300ms straight, 750ms diagonal)
3. **Only proceeds after confirmation** or timeout
4. **Retry mechanism** on failure:
   - First failure: retry
   - Second failure on same tile: temporarily block the tile for 3000ms

#### Key Code:
```javascript
// actionHandlers.js - performWalk()
keyPress(dirKey, { type: 'movement' });
await awaitWalkConfirmation(
  workerState,
  config,
  posCounterBeforeMove,
  pathCounterBeforeMove,
  timeout,  // 300ms or 750ms depending on diagonal
);
```

#### Confirmation Mechanism:
```javascript
// asyncUtils.js - awaitWalkConfirmation()
export const awaitWalkConfirmation = (
  workerState,
  config,
  posCounterBeforeMove,
  pathCounterBeforeMove,
  timeoutMs,
) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error(`awaitWalkConfirmation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const intervalId = setInterval(() => {
      const posChanged =
        workerState.playerPosArray &&
        Atomics.load(
          workerState.playerPosArray,
          PLAYER_POS_UPDATE_COUNTER_INDEX,
        ) > posCounterBeforeMove;

      const pathChanged =
        workerState.pathDataArray &&
        Atomics.load(workerState.pathDataArray, PATH_UPDATE_COUNTER_INDEX) >
          pathCounterBeforeMove;

      if (posChanged || pathChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, config.stateChangePollIntervalMs);  // Poll every 5ms
  });
};
```

---

### **Targeting Movement (Problematic) - `electron/workers/targeting/targetingLogic.js`**

#### Movement Flow:
1. **Check cooldown**: `now - lastMovementTime < MOVEMENT_COOLDOWN_MS` (50ms)
2. **Send keypress** for movement direction
3. **Update timestamp**: `lastMovementTime = now`
4. **Immediately return** - NO CONFIRMATION WAIT
5. Main loop continues at 50ms intervals

#### Key Code:
```javascript
// targetingLogic.js - manageMovement()
const now = Date.now();

if (
  !playerMinimapPosition ||
  path.length < 2 ||
  now - targetingContext.lastMovementTime < MOVEMENT_COOLDOWN_MS ||  // 50ms cooldown
  workerContext.pathInstanceId !== currentTarget.instanceId
) {
  return;
}

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
  targetingContext.lastMovementTime = now;  // Update and done - NO WAIT
}
```

---

## The Problem

### **Cavebot Behavior (Good):**
```
Time 0ms:   Send keypress 'w' (move north)
Time 5ms:   Poll SAB - no change
Time 10ms:  Poll SAB - no change
...
Time 180ms: Poll SAB - PLAYER_POS_UPDATE_COUNTER incremented!
Time 180ms: Movement confirmed, proceed to next decision
Time 180ms: Evaluate new position, decide next move
```
**Result:** One keypress per tile movement. Reliable.

### **Targeting Behavior (Bad):**
```
Time 0ms:   Send keypress 'w' (move north)
Time 0ms:   Set lastMovementTime = 0
Time 50ms:  Main loop tick - cooldown expired (50ms passed)
Time 50ms:  Send keypress 'w' again (player still moving from first press!)
Time 50ms:  Set lastMovementTime = 50
Time 100ms: Main loop tick - cooldown expired
Time 100ms: Send keypress 'w' again (player moved 1 tile but now gets 2nd press)
...
```
**Result:** Multiple keypresses sent while player is still executing the first movement. **OVERSTEPS.**

---

## Why Targeting Oversteps

1. **No Movement Confirmation:** Targeting sends a keypress and immediately considers it "done"
2. **Time-based Cooldown Only:** The 50ms cooldown is arbitrary and doesn't reflect actual game movement completion
3. **Tibia Movement Timing:** In Tibia, a tile movement can take:
   - ~150-300ms for straight movement
   - ~400-750ms for diagonal movement
   - Variable based on server lag, creature blocking, etc.
4. **Race Condition:** With a 50ms loop + 50ms cooldown:
   - Loop at 0ms: Send move
   - Loop at 50ms: Cooldown expired, send move again
   - Loop at 100ms: Cooldown expired, send move again
   - Player has only moved 1 tile but received 3 keypresses!

---

## Solution: Implement Poll-and-Wait Mechanism

The targeting worker needs to adopt the same **await confirmation** pattern as cavebot:

### Required Changes:

1. **Import awaitWalkConfirmation** from cavebot helpers
2. **Track counters before movement**
3. **Await confirmation after keypress**
4. **Handle timeouts gracefully**
5. **Remove time-based cooldown** (replaced by confirmation wait)

### Implementation in `targetingLogic.js`:

```javascript
// Add to imports
import { awaitWalkConfirmation } from '../cavebot/helpers/asyncUtils.js';

// Modify manageMovement to be properly async
export async function manageMovement(
  workerContext,
  targetingContext,
  currentTarget
) {
  // ... existing checks ...

  // Remove the lastMovementTime cooldown check entirely
  if (
    !playerMinimapPosition ||
    path.length < 2 ||
    workerContext.pathInstanceId !== currentTarget.instanceId
  ) {
    return;
  }

  const nextStep = path[1];
  const dirKey = getDirectionKey(playerMinimapPosition, nextStep);

  if (dirKey) {
    // Capture counters BEFORE movement
    const posCounterBeforeMove = workerContext.lastPlayerPosCounter;
    const pathCounterBeforeMove = workerContext.lastPathDataCounter;
    
    // Determine timeout based on diagonal movement
    const isDiagonal = ['q', 'e', 'z', 'c'].includes(dirKey);
    const timeout = isDiagonal ? 750 : 300;  // Match cavebot config

    // Send keypress
    parentPort.postMessage({
      type: 'inputAction',
      payload: {
        type: 'movement',
        action: { module: 'keypress', method: 'sendKey', args: [dirKey, null] },
      },
    });

    // AWAIT CONFIRMATION - This is the critical fix
    try {
      await awaitWalkConfirmation(
        workerContext,
        { stateChangePollIntervalMs: 5 },  // 5ms poll interval
        posCounterBeforeMove,
        pathCounterBeforeMove,
        timeout
      );
    } catch (error) {
      // Movement timed out - this is okay, just log and continue
      console.log('[Targeting] Movement confirmation timed out');
    }
  }
}
```

### Additional Requirements:

**targetingWorker.js must pass required data to manageMovement:**
```javascript
await manageMovement(
  { 
    ...workerState, 
    parentPort, 
    sabStateManager,
    lastPlayerPosCounter: workerState.lastWorldStateCounter,  // ADD THIS
    lastPathDataCounter: workerState.lastPathDataCounter,     // ADD THIS
    playerPosArray: workerData.playerPosSAB ? new Int32Array(workerData.playerPosSAB) : null,  // ADD THIS
    pathDataArray: workerData.pathDataSAB ? new Int32Array(workerData.pathDataSAB) : null,     // ADD THIS
  },
  movementContext,
  targetingState.currentTarget
);
```

---

## Expected Outcome

After implementing poll-and-wait:

1. **One keypress per tile** - No more spam
2. **Reliable movement** - Matches cavebot quality
3. **No oversteps** - Movement waits for confirmation
4. **Proper timeouts** - Handles diagonal vs straight movement
5. **Graceful failures** - Timeout doesn't crash, just logs and continues

---

## Performance Impact

**Cavebot loop speed:** 50ms (with await confirmation built-in)
**Targeting loop speed:** 50ms (will now include await confirmation)

**Net effect:** None. The targeting loop already waits 50ms between ticks. Now it will spend that time productively waiting for movement confirmation instead of blindly spamming inputs.

---

## Conclusion

The targeting worker's movement system is fundamentally flawed because it uses **time-based cooldowns** instead of **state-based confirmation**. This causes it to send multiple movement commands before the first one completes, resulting in overstepping.

The fix is to adopt cavebot's battle-tested **poll-and-wait** mechanism using SharedArrayBuffer atomic counters to confirm each movement before sending the next command.
