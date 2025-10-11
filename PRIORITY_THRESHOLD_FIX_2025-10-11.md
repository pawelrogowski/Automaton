# Priority Threshold Removal - 2025-10-11

## Problem Description

When entering a new floor with multiple creatures of the same type (e.g., 3 wasps), the targeting system would:

1. ✅ Correctly identify the adjacent wasp as the best target (score: -1499)
2. ❌ Tab-click the first battle list entry (far wasp) instead
3. ❌ Get stuck targeting the far wasp
4. ❌ Refuse to switch to the adjacent wasp (better target)
5. ❌ Stand still instead of moving or attacking

## Root Cause

**Location:** `electron/workers/targetingWorker.js:443-454`

The ENGAGING state had a **redundant priority threshold check** that blocked target switching:

```js
// OLD CODE (BAD)
const PRIORITY_THRESHOLD = 2;
if (bestRule && currentRule && bestRule.priority >= currentRule.priority + PRIORITY_THRESHOLD) {
  // Switch to better target
  logger('debug', `[TARGET CHANGE] PREEMPT → ...`);
  transitionTo(FSM_STATE.ACQUIRING, `Found higher priority target`);
  return;
}
// If priority check fails, NO SWITCH happens - stuck with current target!
```

### Why This Blocked Switching:

**Scenario:** 3 wasps on screen, all with same priority (e.g., 5)
- **Far wasp (targeted):** Distance 5, score = -1000 + 5 = **-995**
- **Adjacent wasp (better):** Distance 1, adjacent bonus, score = -1000 + 1 - 500 = **-1499**

**What Happened:**
1. `selectBestTarget` correctly identified adjacent wasp as better (score diff: 504 > threshold of 10)
2. Returns adjacent wasp as `bestOverallTarget`
3. **Priority check:** `5 >= 5 + 2`? **FALSE** (5 >= 7 is false)
4. Target switch **BLOCKED**
5. Stuck with far wasp forever

### The Contradiction:

- **selectBestTarget** (with hysteresis): "Switch! Adjacent wasp is 504 points better!"
- **Priority threshold gate**: "No! Priority not 2 levels higher!"
- **Result**: Conflicting logic, target switching broken

## Why Priority Threshold Was Wrong

1. **Redundant**: `selectBestTarget` already considers priority in scoring:
   ```js
   score = -rule.priority * 1000;  // Higher priority = lower (better) score
   ```

2. **Has Hysteresis**: `selectBestTarget` already has built-in hysteresis (SCORE_THRESHOLD = 10) to prevent flip-flopping between similar targets

3. **Blocks Valid Switches**: Creatures with same priority but MUCH better scores (adjacent vs far) couldn't preempt

4. **No Added Value**: The check didn't add safety or stability - it just blocked correct behavior

## The Fix

**Removed the entire priority threshold check:**

```js
// NEW CODE (GOOD)
const bestOverallTarget = selectBestTarget(getCreaturesFromSAB, targetingList, targetingState.currentTarget);
if (
  bestOverallTarget &&
  bestOverallTarget.instanceId !== targetingState.currentTarget.instanceId
) {
  // selectBestTarget already handles priority in scoring (-priority * 1000)
  // and has hysteresis (SCORE_THRESHOLD = 10) to prevent flip-flopping
  // Trust its decision - if it returns a different target, we should switch
  
  logger('debug', `[TARGET CHANGE] PREEMPT → ${bestOverallTarget.name} ...`);
  targetingState.pathfindingTarget = bestOverallTarget;
  updateDynamicTarget(parentPort, bestOverallTarget, targetingList);
  transitionTo(FSM_STATE.ACQUIRING, `Found better target`);
  return;
}
```

## Impact & Benefits

### Before Fix:
- ❌ Stuck with first-targeted creature
- ❌ Can't switch to adjacent/better targets with same priority
- ❌ Stands still waiting for far creature
- ❌ Inefficient targeting

### After Fix:
- ✅ Switches to better targets based on score
- ✅ Adjacent creatures preempt far creatures (same priority)
- ✅ Respects selectBestTarget's intelligent scoring
- ✅ Dynamic target selection in ENGAGING state
- ✅ More efficient combat

## Testing

### Scenario: 3 Wasps (Same Priority)
- Wasp A: 5 tiles away (first in battle list)
- Wasp B: 2 tiles away
- Wasp C: Adjacent

**Expected Behavior:**
1. Initial target selection picks Wasp C (adjacent, best score)
2. If Wasp A gets targeted first (Tab click), switches to Wasp C
3. Logs show: `[TARGET CHANGE] PREEMPT → Wasp (ID: 103, Adjacent: true) replaces Wasp (ID: 101, Adjacent: false)`
4. Attacks adjacent wasp immediately

### Scenario: High Priority vs Low Priority
- Dragon: Priority 10, 3 tiles away
- Rat: Priority 1, adjacent

**Expected Behavior:**
1. Targets Dragon (much higher priority, score dominates)
2. Dragon score: -10000 + 3 = **-9997**
3. Rat score: -1000 + 1 - 500 = **-1499**
4. Dragon wins by priority (as intended)
5. No switch to Rat (priority difference is massive)

## Code Changes

**File:** `electron/workers/targetingWorker.js`

**Lines Changed:** 427-455 (29 lines)

**Changes:**
1. Removed `PRIORITY_THRESHOLD = 2` constant
2. Removed priority comparison: `bestRule.priority >= currentRule.priority + PRIORITY_THRESHOLD`
3. Added explanatory comment about trusting selectBestTarget
4. Enhanced logging to show adjacent status
5. Changed log message from "Found higher priority target" to "Found better target"

## Conclusion

The priority threshold check was a **defensive programming pattern that backfired**. It tried to add stability but instead created a bug where valid target switches were blocked.

**Lesson**: When you have a sophisticated scoring system with hysteresis (`selectBestTarget`), don't add redundant gates on top. Trust the scoring logic or improve it - don't override it with simplistic checks.

**Result**: Targeting now works as designed - responsive, intelligent, and respects the scoring system's decisions.
