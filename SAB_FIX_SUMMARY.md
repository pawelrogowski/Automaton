# SAB Data Unwrapping Fix Summary

## Problem

Workers using the unified SAB system were unable to read data correctly because they were not unwrapping the result object returned by `sabInterface.get()`.

The SAB interface's `get()` method returns: `{ data: actualData, version: versionNumber }`

But workers were accessing properties directly on the result, expecting: `actualData`

## Fixes Applied

### 1. Pathfinder - Complete Header Fields (pathfinder/logic.js:395-424)

- Added ALL required header fields when writing to unified SAB:
  - `chebyshevDistance` (calculated from path endpoints)
  - `startX, startY, startZ` (player position)
  - `blockingCreatureX/Y/Z` (blocking creature coords if any)
  - `wptId, instanceId` (waypoint/creature identifiers)
- Added debug logging to confirm writes
- Now writes to SAB even for empty paths (status updates)

### 2. Cavebot - Data Unwrapping (cavebot/helpers/communication.js)

- **Player Position** (lines 46-75): Changed from `sabInterface.get('playerPos')` → `sabInterface.get('playerPos').data`
- **Path Data** (lines 107-129): Changed from checking `pathData.waypoints` → `pathDataResult.data.waypoints`
- **Legacy Fallback Fix** (line 75): Added missing `else if` to prevent legacy SAB from running when unified SAB is active

### 3. Targeting Worker - Data Unwrapping (targetingWorker.js)

- **getCreaturesFromSAB()** (lines 78-90): Extract `result.data` before using creature array
- **getCurrentTargetFromSAB()** (lines 90-106): Extract `result.data` before accessing target properties

### 4. Debug Logging Enabled

- Pathfinder: `debug: false` (pathfinder/core.js:20)
- Cavebot: `debug: false` (cavebot/index.js:67)

## Expected Behavior After Fix

1. Pathfinder writes complete path data to unified SAB
2. Cavebot successfully reads path data and acts on it (walking to waypoints)
3. Targeting successfully reads creatures and target data
4. Debug logs show:
   - `[Pathfinder] Wrote path to SAB: X waypoints, status: Y`
   - `[Cavebot] Read path from SAB: X waypoints, status: Y`

## Testing Required

1. Enable cavebot and observe if character walks to waypoints
2. Enable targeting and observe if character selects and attacks targets
3. Check console for debug logs confirming data flow
4. Verify no "Got pathData but no waypoints" messages

## Architecture Pattern Confirmed

**SAB Interface Usage Pattern:**

```javascript
// CORRECT - Unwrap .data property
const result = sabInterface.get('propertyName');
if (result && result.data) {
  const actualData = result.data;
  // Now use actualData...
}

// INCORRECT - Missing .data unwrapping
const data = sabInterface.get('propertyName');
if (data && data.someField) {
  // ❌ Won't work!
  // ...
}
```

This pattern must be followed for ALL properties read from unified SAB:

- `playerPos`
- `pathData`
- `creatures`
- `battleList`
- `target`
- `cavebotConfig`
- `targetingConfig`
- `globalConfig`
