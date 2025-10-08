# Targeting Stability Fix - 2025-10-08

## Problem

The targeting system was switching targets seemingly at random, even when engaged with a creature. This caused erratic behavior where the bot would start attacking one creature, then suddenly switch to another without clear reason.

## Root Cause Analysis

After reviewing the code, the main issues were:

1. **No Hysteresis in Target Selection**
   - `selectBestTarget()` always returned the "best" target based on current scores
   - Tiny distance changes (0.1 tiles) would cause score fluctuations
   - Two creatures with equal priority could swap ranks every frame

2. **Preemption Logic Too Aggressive**
   - Ran every 50ms during combat
   - Would switch if new target had **any** higher priority (even 1 point difference)
   - No threshold to prevent switching for minor improvements

3. **Score Instability**
   - Score calculation: `score = -priority * 1000 + distance`
   - Distance changes constantly as creatures/player move
   - Example: Creature at 2.3 tiles vs 2.5 tiles = only 0.2 point difference
   - This caused constant re-ranking of equal-priority creatures

## Solution Implemented

### 1. **Hysteresis in Target Selection**

**File:** `electron/workers/targeting/targetingLogic.js`

Added a `currentTarget` parameter to `selectBestTarget()`:

```javascript
export function selectBestTarget(sabStateManager, targetingList, currentTarget = null) {
  // ... existing selection logic ...
  
  // NEW: Hysteresis check
  if (currentTarget && currentTarget.instanceId) {
    const currentCandidate = validCandidates.find(
      (c) => c.creature.instanceId === currentTarget.instanceId
    );
    
    if (currentCandidate) {
      const SCORE_THRESHOLD = 10; // Must be 10+ points better to switch
      const scoreDifference = currentCandidate.score - bestCandidate.score;
      
      // Only switch if significantly better
      if (scoreDifference < SCORE_THRESHOLD) {
        return currentTarget; // Keep current target
      }
    }
  }
  
  return bestCandidate.creature;
}
```

**How it works:**
- When a target is already engaged, we check if it's still in the valid candidates list
- If current target's score is within 10 points of the best candidate, **keep current target**
- Only switch if the new target is **significantly better** (10+ point advantage)

**Why 10 points?**
- Priority difference: 1 priority level = 1000 points
- Distance: Typical range 0-10 tiles
- Adjacent bonus: -500 points
- 10 points = about 10 tiles of distance difference, enough to prevent micro-adjustments but allow meaningful switches

---

### 2. **Priority Threshold for Preemption**

**File:** `electron/workers/targetingWorker.js`

Changed the preemption logic to require a **2-priority minimum difference**:

```javascript
const PRIORITY_THRESHOLD = 2;
if (bestRule && currentRule && bestRule.priority >= currentRule.priority + PRIORITY_THRESHOLD) {
  // Only NOW do we preempt
  logger('info', `[FSM] Preempting ${targetingState.currentTarget.name} (Prio: ${currentRule.priority}) for ${bestOverallTarget.name} (Prio: ${bestRule.priority})`);
  transitionTo(FSM_STATE.ACQUIRING, `Found higher priority target`);
}
```

**Before:** Would switch if new priority >= old priority + 1
**After:** Only switches if new priority >= old priority + 2

**Why 2 levels?**
- Prevents switching between creatures with 1 priority difference (often unintentional)
- Requires a **clear and intentional** priority separation in targeting rules
- Still allows switching when a genuinely high-priority threat appears

---

### 3. **Current Target Passed During Engagement**

**File:** `electron/workers/targetingWorker.js`

Modified `handleEngagingState()` to pass current target:

```javascript
// Pass current target for hysteresis - prevents switching for minor score differences
const bestOverallTarget = selectBestTarget(sabStateManager, targetingList, targetingState.currentTarget);
```

**But NOT in SELECTING state:**

```javascript
function handleSelectingState() {
  // Don't pass current target in SELECTING state - we want fresh evaluation
  const bestTarget = selectBestTarget(sabStateManager, targetingList, null);
}
```

**Why this distinction?**
- **SELECTING state**: No target yet, should find the absolute best
- **ENGAGING state**: Already committed to a target, only switch if significantly better

---

## Behavior Changes

### Before Fix

```
Frame 1: Attacking Rat A (priority 5, distance 2.3)
Frame 2: Rat B moves closer (distance 2.1), SWITCH to Rat B
Frame 3: Rat A moves closer (distance 2.0), SWITCH back to Rat A
Frame 4: Rat B moves closer (distance 1.9), SWITCH to Rat B
... (constant switching)
```

### After Fix

```
Frame 1: Attacking Rat A (priority 5, distance 2.3)
Frame 2: Rat B moves closer (distance 2.1), score difference = 0.2 < 10, KEEP Rat A
Frame 3: Rat A moves closer (distance 2.0), still attacking Rat A
Frame 4: Rat B moves closer (distance 1.9), score difference = 0.4 < 10, KEEP Rat A
Frame 5: Dragon appears (priority 10), priority difference = 5 >= 2, SWITCH to Dragon
```

---

## User-Facing Behavior

### ✅ **What Still Works:**

1. **Adjacency affects scoring** - Adjacent creatures get -500 score bonus (strongly preferred)
2. **Creature running away doesn't cause switch** - Distance increase doesn't trigger re-evaluation due to hysteresis
3. **High priority threats preempt** - If a creature with 2+ higher priority appears, targeting switches
4. **Initial target selection** - First target choice is still optimal based on all criteria

### ✅ **What Changed (Improvements):**

1. **Stable targeting during combat** - Once engaged, won't switch for minor distance changes
2. **Less random switching** - Two rats with same priority won't cause constant switching
3. **Intentional priority separation required** - Preemption only happens for significant priority differences

### ⚠️ **What to Watch For:**

1. **Stuck on suboptimal target** - If a much better target appears but is only 1 priority higher, won't switch
   - **Solution:** Ensure priority differences of 2+ for creatures you want to preempt for
   
2. **Won't switch away from fleeing creature** - This is intentional per requirements
   - Creature running away = distance increases, but hysteresis keeps current target

---

## Configuration

### Tunable Parameters

If behavior needs adjustment, these constants can be modified:

**`targetingLogic.js:157`**
```javascript
const SCORE_THRESHOLD = 10; // Default: 10
```
- **Increase** (e.g., 20): More stable, harder to switch targets
- **Decrease** (e.g., 5): More responsive, easier to switch

**`targetingWorker.js:301`**
```javascript
const PRIORITY_THRESHOLD = 2; // Default: 2
```
- **Increase** (e.g., 3): Only preempt for very high priority threats
- **Decrease** (e.g., 1): More aggressive preemption

---

## Testing Results

### Build Status
✅ **Compiled successfully** - No errors

### Expected Behavior
When testing, you should observe:
- [ ] Target stays locked on a creature even as it moves
- [ ] No switching between creatures of equal priority
- [ ] Switches only occur when a significantly higher priority target appears
- [ ] Creature running away doesn't cause target switch
- [ ] Adjacent creatures are still preferred when selecting initial target

---

## Files Modified

1. **`electron/workers/targeting/targetingLogic.js`**
   - Added `currentTarget` parameter to `selectBestTarget()`
   - Implemented hysteresis logic with 10-point threshold
   - ~20 lines added

2. **`electron/workers/targetingWorker.js`**
   - Updated `handleSelectingState()` to pass `null` for fresh selection
   - Updated `handleEngagingState()` to pass `currentTarget` for stability
   - Increased priority threshold from 1 to 2
   - ~5 lines modified

---

## Performance Impact

**Negligible** - Added logic is very lightweight:
- One `find()` operation per target evaluation (only during ENGAGING state)
- Simple arithmetic comparison (score difference)
- No additional SAB reads or IPC calls

---

## Related Issues

This fix addresses the "random target switching" issue reported during testing. The targeting system is now much more stable while still respecting priority rules and adjacency preferences.

---

## Future Enhancements (Optional)

If further stability issues arise, consider:

1. **Time-based hysteresis** - Require minimum 2-3 seconds on a target before allowing switch
2. **Combat state awareness** - Only allow switches if current target at full HP (hasn't been damaged yet)
3. **User-configurable thresholds** - Expose SCORE_THRESHOLD and PRIORITY_THRESHOLD in UI settings

---

**Date:** 2025-10-08  
**Status:** ✅ Implemented and Built  
**Testing:** ⏳ Pending runtime verification
