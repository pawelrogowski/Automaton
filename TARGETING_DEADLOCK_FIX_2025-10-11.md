# Targeting Deadlock Fix - 2025-10-11

## Problems Identified

### 1. Wrong Parameter Type Passed to acquireTarget
**Location:** `electron/workers/targetingWorker.js:380`

**Bug:** The function was passing the entire `pathfindingTarget` object instead of just the `instanceId`:
```js
// BEFORE (WRONG)
pathfindingTarget  // Pass the full pathfindingTarget object as a new argument

// AFTER (FIXED)
pathfindingTarget.instanceId  // Pass just the instanceId (number), not the whole object
```

**Impact:** 
- The `acquireTarget` function expects `targetInstanceId` to be a number
- When it was an object, the comparison `c.instanceId === targetInstanceId` would always fail
- This broke game world click logic completely (never triggered)
- It also broke the specific instance matching when multiple creatures share the same name

### 2. Tab Targeting Infinite Loop
**Location:** `electron/workers/targeting/targetingLogic.js:287-289`

**Bug:** When multiple creatures with the same name exist:
1. SELECTING picks the first reachable one (e.g., Wasp #1)
2. ACQUIRING tries Tab (if it's at currentTargetIndex + 1)
3. Tab targets Wasp #1, but it's unreachable or wrong instance ID
4. Verification fails, clears timestamp but keeps battleListIndex
5. Next tick: acquireTarget is called with same lastClickedIndex
6. Tab logic fires again (desiredTargetIndex === currentTargetIndex + 1 still true)
7. Targets the SAME Wasp #1 again → infinite loop

**Root Cause:** Tab/Grave logic doesn't account for cycling through multiple entries with the same name.

**Fix:** Disable Tab/Grave when cycling (when `lastClickedIndex >= 0`):
```js
// BEFORE
if (canUseTab && !forceMouseClick) {
  method = 'tab';
}

// AFTER
const isCycling = lastClickedIndex >= 0;
if (canUseTab && !forceMouseClick && !isCycling) {
  method = 'tab';
}
```

**Impact:**
- First attempt uses Tab/Grave (fast, natural)
- After first attempt, switches to mouse clicks on battle list
- Mouse clicks properly cycle through entries by incrementing index
- Escape valve prevents infinite loops

### 3. Game World Click Never Triggered
**Causes:**
1. Wrong parameter type (fixed above)
2. Creatures might not have `adjacentStationaryDuration` properly set
3. The 300ms threshold might be too strict

**Debug Added:**
- Console logs in `acquireTarget` to trace why game world clicks don't fire
- Shows: creature found, adjacent status, stationary duration, hp status, config enabled

**Next Steps:**
- Run targeting and check console for `[acquireTarget]` logs
- Verify creatures have `isAdjacent` and `adjacentStationaryDuration` properties
- Check if `GAMEWORLD_CONFIG.ENABLED` is actually true
- Confirm `adjacentStationaryDuration` reaches 300ms threshold

## Testing Checklist

### Scenario 1: Multiple Wasps (Same Name)
- [ ] Place 3 wasps on screen at different distances
- [ ] Enable targeting with "Wasp" in targeting list
- [ ] Verify it cycles through all 3 wasps (not stuck on first unreachable one)
- [ ] Check logs show "method: mouse" after first attempt

### Scenario 2: Game World Click
- [ ] Have a creature adjacent to player
- [ ] Ensure creature is stationary for 300+ms
- [ ] Check console logs for game world click decision
- [ ] Verify `[acquireTarget]` shows: adjacent: true, stationaryDur: 300+
- [ ] Confirm click coordinates are computed and mouse click sent

### Scenario 3: Tab/Grave Still Works
- [ ] Single creature in battle list, no current target
- [ ] First targeting attempt should use Tab (fast)
- [ ] Log should show "method: tab"

## Files Modified

1. **electron/workers/targetingWorker.js**
   - Line 386: Fixed parameter passing (instanceId instead of whole object)
   - Line 321-322: Clarified comment about battleListIndex preservation

2. **electron/workers/targeting/targetingLogic.js**
   - Lines 279-283: Added `isCycling` check
   - Lines 287-289: Modified Tab/Grave conditions to exclude cycling
   - Lines 219-224: Added debug logging for game world click decisions

## Rationale

**Why disable Tab/Grave when cycling?**
- Tab/Grave targets by relative position in battle list (±1 from current)
- When multiple creatures share a name, we can't know which physical creature corresponds to which battle list entry
- We must click each entry and verify in-game via instanceId
- Mouse clicks allow us to cycle through entries by index
- Tab would just retarget the same entry repeatedly

**Why keep first attempt as Tab/Grave?**
- Tab/Grave is faster than mouse clicks (no coordinate calculation)
- Most of the time, the first attempt succeeds
- Only fall back to mouse when we need to cycle (edge case)

**Why pass instanceId instead of whole object?**
- Type safety: function signature expects number, not object
- Enables proper comparison: `c.instanceId === targetInstanceId`
- Allows game world click to find the exact creature we want
- Without this, multiple creatures with same name can never be distinguished

## Expected Behavior After Fix

1. **Normal case (single creature or first is correct):**
   - Uses Tab/Grave (fast)
   - Targets immediately
   - No cycling needed

2. **Multiple creatures with same name:**
   - First attempt: Tab/Grave
   - If wrong creature: switches to mouse clicks
   - Cycles through battle list entries until finding correct instanceId
   - No infinite loops

3. **Game world clicks (if conditions met):**
   - Creature is adjacent and stationary for 300ms
   - Direct click on creature in game world
   - Faster than battle list clicks
   - More reliable for stationary targets

## Additional Fix: Removed Priority Threshold in ENGAGING State

### Problem Found (2025-10-11 11:49):

**Location:** `electron/workers/targetingWorker.js:444`

The ENGAGING state had a redundant priority check that blocked target switching:

```js
// OLD CODE (REMOVED)
const PRIORITY_THRESHOLD = 2;
if (bestRule.priority >= currentRule.priority + PRIORITY_THRESHOLD) {
  // Only switch if 2+ priority levels higher
}
```

**Why This Was Bad:**
- `selectBestTarget` already handles priority in scoring: `score = -priority * 1000`
- `selectBestTarget` has hysteresis (SCORE_THRESHOLD = 10) to prevent flip-flopping
- The additional priority gate blocked valid switches, e.g.:
  - Far wasp targeted (score: -995)
  - Adjacent wasp available (score: -1499, much better!)
  - Same priority (5 vs 5), so 5 >= 5+2 is FALSE → **blocked!**
  - Result: Stuck with far wasp, can't switch to adjacent

**Fix:** Removed the priority threshold check entirely. Now trusts `selectBestTarget`'s decision.

**Impact:**
- Target switching now works correctly in ENGAGING state
- Adjacent creatures can preempt far creatures (same priority)
- Score-based selection is respected (priority, distance, adjacent bonus)
- No more getting stuck with wrong target

## Known Limitations

1. Game world clicks require:
   - Creature must be adjacent (distance ≤ 1)
   - Creature must be stationary for 300ms
   - HP bar must not be "Obstructed"
   - Regions and player position must be available
   - `adjacentStationaryDuration` must be tracked by creatureMonitor

2. Battle list cycling:
   - Still requires multiple clicks when many creatures share a name
   - Each click has a 400ms verification timeout
   - Not instant, but escapes deadlocks

3. Tab/Grave still used on first attempt:
   - 15% random override to mouse (maintains variety)
   - Disabled when cycling (prevents loops)
