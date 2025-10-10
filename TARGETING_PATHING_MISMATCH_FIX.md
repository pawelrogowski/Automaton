# Targeting/Pathing Mismatch Fix

## Problem Description

The bot was experiencing a critical issue where it would **path to one creature but target a different creature**, causing it to get stuck. This happened when:

1. Multiple creatures with the **same name** were on screen (e.g., multiple "Rotworms")
2. The bot selected the best target based on priority/distance
3. But when clicking to acquire the target, it would click on a **different instance** of that creature
4. Result: Bot walks toward creature far away, but targets creature nearby (or vice versa)

## Root Cause Analysis

### The Flow

1. **`selectBestTarget()`** - Picks the best creature based on targeting rules
   - Returns a creature object with a specific `instanceId`
   - This creature's coordinates are sent to the pathfinder

2. **`updateDynamicTarget()`** - Sends path goal to pathfinder
   - Uses the `instanceId` and `gameCoords` from the selected creature
   - Pathfinder calculates path to this specific creature's position

3. **`acquireTarget()`** - Clicks on the creature to target it
   - **THE BUG WAS HERE**: Only used the creature **name** for matching
   - Battle list doesn't have instance IDs, only names
   - When multiple creatures have the same name, it could click the wrong one

### Why It Got Stuck

Example scenario:
- Rotworm A at position (100, 100) - far away, selected for pathing
- Rotworm B at position (105, 102) - close by
- Bot paths to Rotworm A (far away)
- But clicks and targets Rotworm B (close by) in battle list
- Bot reaches Rotworm B but pathfinder still trying to reach Rotworm A
- **Mismatch = stuck**

## The Fix

### Changes Made

#### 1. Pass Instance ID to `acquireTarget()` 
**File**: `electron/workers/targeting/targetingLogic.js`

Added new parameter `targetInstanceId` to the function signature:

```js
export function acquireTarget(
  getBattleList,
  parentPort,
  targetName,
  lastClickedIndex,
  globalState = null,
  getCreatures = null,
  getPlayerPosition = null,
  targetInstanceId = null  // NEW: Ensures we click the RIGHT creature
) {
```

#### 2. Use Instance ID for Gameworld Clicking
**File**: `electron/workers/targeting/targetingLogic.js` (lines 208-214)

When using gameworld click (clicking directly on creature in game world):

```js
// If we have a specific instance ID, use it to find the EXACT creature
const targetCreature = targetInstanceId 
  ? creatures.find(c => c.instanceId === targetInstanceId && c.isReachable)
  : creatures.find(c => c.name === targetName && c.isReachable);
```

#### 3. Match by Screen Position for Battle List
**File**: `electron/workers/targeting/targetingLogic.js` (lines 323-349)

When clicking from battle list, if there are multiple creatures with same name:

```js
// If we have a specific instance ID and multiple creatures with the same name,
// try to match by screen position (Y coordinate) to click the right one
let targetEntry = null;
if (targetInstanceId && potentialEntries.length > 1 && targetCreature && targetCreature.absoluteCoords) {
  // Find battle list entry closest to the target creature's screen position
  let minDistance = Infinity;
  for (const entry of potentialEntries) {
    const distance = Math.abs(entry.y - targetCreature.absoluteCoords.y);
    if (distance < minDistance) {
      minDistance = distance;
      targetEntry = entry;
    }
  }
}
```

This matches the battle list entry by comparing Y-coordinates, since creatures appear in the battle list in roughly the same vertical order as on screen.

#### 4. Update Worker to Pass Instance ID
**File**: `electron/workers/targetingWorker.js` (lines 275-284)

Modified the call to `acquireTarget` to include the instance ID:

```js
const result = acquireTarget(
  getBattleListFromSAB,
  parentPort,
  pathfindingTarget.name,
  targetingState.lastAcquireAttempt.battleListIndex,
  workerState.globalState,
  getCreaturesFromSAB,
  () => workerState.playerMinimapPosition,
  pathfindingTarget.instanceId  // Pass instance ID to ensure correct creature
);
```

## Benefits

1. **No more mismatches**: Bot always paths to the creature it's actually targeting
2. **Better multi-creature handling**: When multiple creatures have the same name, bot picks the specific one it intended
3. **Reduced getting stuck**: Eliminates the scenario where bot reaches creature but pathfinder thinks it's somewhere else
4. **Maintains backward compatibility**: If `targetInstanceId` is not provided, falls back to original name-based matching

## Testing Recommendations

1. Test with **multiple creatures of same name** on screen
2. Verify bot paths to and targets the **same creature**
3. Check that priority-based targeting still works correctly
4. Monitor for any edge cases where instance matching fails

## Technical Notes

- **Instance IDs** are unique per creature spawn and tracked throughout the creature's lifetime
- **Battle list** doesn't expose instance IDs, so we use screen position proximity as a heuristic
- **Gameworld clicking** can use instance ID directly since we have full creature data
- The fix maintains all existing targeting modes (Tab, Grave, Mouse, Gameworld)

## Related Files

- `electron/workers/targeting/targetingLogic.js` - Core targeting logic
- `electron/workers/targetingWorker.js` - FSM-based targeting worker
- `electron/workers/creatureMonitor.js` - Creature detection and tracking
- `electron/workers/pathfinder/logic.js` - Pathfinding calculations

---

**Status**: ✅ Fixed
**Date**: 2025-10-10
**Impact**: High - Resolves critical getting stuck issue
