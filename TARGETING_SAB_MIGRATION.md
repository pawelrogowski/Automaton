# Targeting Worker SAB Migration - Summary

## Date
2025-10-08

## Problem
The targeting worker was not moving correctly after the unified SAB migration. Specifically:
1. Targeting would move 1 tile and then stop
2. Paths showed "NO_VALID_END" status
3. The worker wasn't recalculating paths when creatures moved

## Root Cause
The creatures data read from the unified SAB did not include the `gameCoords` property that the targeting logic expected. The SAB schema stores creature positions as `x, y, z` fields (game coordinates), but the targeting worker expected a nested `gameCoords: { x, y, z }` object for compatibility with the pathfinder.

## Solution

### 1. Fixed Creature Data Mapping
**File:** `electron/workers/targetingWorker.js`

Modified `getCreaturesFromSAB()` to construct the `gameCoords` property from SAB data:

```javascript
const getCreaturesFromSAB = () => {
  if (sabInterface) {
    try {
      const result = sabInterface.get('creatures');
      if (result && result.data && Array.isArray(result.data)) {
        // Add gameCoords property from x,y,z fields for compatibility
        return result.data.map(creature => ({
          ...creature,
          gameCoords: { x: creature.x, y: creature.y, z: creature.z }
        }));
      }
    } catch (err) {
      logger('debug', `[TargetingWorker] Failed to read creatures from unified SAB: ${err.message}`);
    }
  }
  return sabStateManager.getCreatures() || [];
};
```

### 2. Simplified Path Acceptance Logic
**File:** `electron/workers/targetingWorker.js`

Updated `updateSABData()` to only accept valid targeting paths:

```javascript
// Accept valid targeting paths: instanceId > 0 means targeting mode
const PATH_STATUS_PATH_FOUND = 1;
const isTargetingPath = (pathData.instanceId || 0) > 0;
const newInstanceId = pathData.instanceId || 0;
const isNewTarget = newInstanceId !== workerState.pathInstanceId && newInstanceId > 0;
const isValidPath = 
  pathData.status === PATH_STATUS_PATH_FOUND && 
  pathData.waypoints && 
  pathData.waypoints.length >= 2;

// Clear path when switching to a new target (even if new path is invalid yet)
if (isNewTarget) {
  workerState.path = [];
  workerState.pathInstanceId = newInstanceId;
}

// Only accept valid paths
if (isTargetingPath && isValidPath) {
  workerState.path = pathData.waypoints;
  workerState.pathfindingStatus = pathData.status;
  workerState.pathWptId = pathData.wptId || 0;
  workerState.pathInstanceId = newInstanceId;
}
```

### 3. Removed Debug Log Spam
Removed excessive debug logging from:
- `electron/workers/targetingWorker.js`
- `electron/workers/targeting/targetingLogic.js`
- `electron/workers/pathfinder/logic.js`
- `electron/workers/movementUtils/confirmationHelpers.js`

## How It Works Now

1. **Creature Detection**: When a creature is detected and targeted, the targeting worker reads creature data from SAB
2. **Game Coordinates**: The `gameCoords` property is constructed from the SAB's `x, y, z` fields
3. **Path Requests**: The targeting worker sends `updateDynamicTarget()` to update the pathfinding goal in Redux
4. **Pathfinder Response**: The pathfinder writes paths to SAB with `instanceId > 0` for targeting mode
5. **Path Acceptance**: Targeting worker only accepts valid paths (status 1, length >= 2, targeting mode)
6. **Creature Movement Detection**: When a creature moves, the targeting worker detects the position change and updates the dynamic target
7. **Stale Path Handling**: When switching to a new creature, the old path is cleared immediately

## Key Design Decisions

- **instanceId as Mode Indicator**: Paths with `instanceId > 0` are targeting paths, `instanceId = 0` are cavebot paths
- **Path Validation**: Only accept paths with `PATH_FOUND` status and at least 2 waypoints
- **Fresh Start on New Target**: Clear the path immediately when a new creature is targeted (different instanceId)
- **Compatibility Layer**: Construct `gameCoords` from SAB data rather than modifying the SAB schema

## Testing Results

✅ Targeting worker successfully moves towards creatures
✅ Paths are recalculated when creatures move
✅ Switching between targets works correctly
✅ Cavebot movement still works as expected
✅ No excessive log spam

## Known Issues

- Path version in Redux updates very rapidly (needs investigation)
- Possible pipe error related to frequent Redux updates

## Files Modified

1. `electron/workers/targetingWorker.js` - Main targeting worker logic
2. `electron/workers/targeting/targetingLogic.js` - Movement and target selection
3. `electron/workers/pathfinder/logic.js` - Removed debug logging
4. `electron/workers/movementUtils/confirmationHelpers.js` - Removed debug logging
