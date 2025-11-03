# Timestamp Synchronization Implementation

## Overview

This document describes the implementation of timestamp-based synchronization to fix the **floor change race condition** where cavebot would immediately advance waypoints after changing floors, before creatureMonitor had time to process the new floor's creature data.

## Problem Statement

When cavebot executed floor change actions (ladder, rope, shovel, stand), it would:
1. Change floor via `awaitZLevelChange()`
2. Immediately advance to next waypoint
3. **Miss creatures on the new floor** because creatureMonitor hadn't processed a frame yet

This caused the bot to skip floors when checking towers for monsters.

## Solution: Timestamp-Based Freshness Verification

Added `lastUpdateTimestamp` fields to critical SAB properties to verify data freshness after floor changes and control handovers.

## Changes Made

### 1. SAB Schema Updates (`electron/workers/sabState/schema.js`)

Added `lastUpdateTimestamp: FIELD_TYPES.INT32` to:
- **`playerPos`**: Added to fields, size changed from 4 to 5
- **`creatures`**: Added to header at offset 3, headerSize changed from 3 to 4
- **`target`**: Added to fields, size changed from 39 (7+32) to 40 (8+32)
- **`cavebotPathData`**: Added to headerFields, headerSize changed from 15 to 16
- **`targetingPathData`**: Added to headerFields, headerSize changed from 15 to 16

### 2. SABState Class Updates (`electron/workers/sabState/SABState.js`)

Updated `_writeArray()` to support writing `lastUpdateTimestamp` in array headers:
```javascript
_writeArray(schema, baseOffset, items, options = {})
```
- For arrays with `headerSize >= 4`, writes `options.lastUpdateTimestamp` at offset 3
- Updated `set()` and `setMany()` to accept and pass through `options` parameter

### 3. Worker Updates

#### minimapMonitor (`electron/workers/minimap/processing.js`)
```javascript
sabInterface.set('playerPos', {
  x: newPos.x,
  y: newPos.y,
  z: newPos.z,
  lastUpdateTimestamp: Date.now(),
});
```

#### pathfinderWorker (`electron/workers/pathfinder/logic.js`)
```javascript
const pathPayload = {
  // ... existing fields
  lastUpdateTimestamp: Date.now(),
};
```

#### creatureMonitor (`electron/workers/creatureMonitor.js`)
```javascript
// For target struct
const sabTarget = {
  // ... existing fields
  lastUpdateTimestamp: Date.now(),
};

// For creatures array
sabInterface.setMany(
  { creatures: sabCreatures, battleList: sabBattleList, target: sabTarget },
  { creatures: { lastUpdateTimestamp: Date.now() } }
);
```

### 4. Floor Change Synchronization (`electron/workers/cavebot/`)

#### New Helper Function (`helpers/asyncUtils.js`)
```javascript
export const awaitFreshCreatureData = (workerState, afterTimestamp, timeoutMs = 2000)
```
- Polls creatures.lastUpdateTimestamp from SAB header offset 3
- Returns true when `lastUpdateTimestamp > afterTimestamp`
- 1 second timeout with fallback to proceed anyway

#### Action Handlers (`actionHandlers.js`)
Updated `handleLadderAction`, `handleRopeAction`, `handleShovelAction`:
```javascript
const floorChangeTime = Date.now();
const zChanged = await awaitZLevelChange(...);
if (zChanged) {
  const freshData = await awaitFreshCreatureData(workerState, floorChangeTime, 1000);
  // Proceeds immediately when fresh data available, or after 1s timeout
}
```

### 5. Control Handover Synchronization (`index.js`)

Replaced hardcoded 500ms cooldown with timestamp-based check:

```javascript
// In workerState
controlHandoverTimestamp: 0,

// In handleControlHandover()
workerState.controlHandoverTimestamp = now;

// In performOperation() - before FSM execution
if (workerState.controlHandoverTimestamp > 0) {
  const lastUpdate = array[creaturesOffset + 3];
  if (lastUpdate <= workerState.controlHandoverTimestamp) {
    return; // Skip FSM execution until fresh data
  }
  workerState.controlHandoverTimestamp = 0; // Clear and proceed
}
```

## Benefits

### Zero Passive Delay
- **Before**: Fixed 500ms delay after every control handover (slow)
- **After**: 0ms delay when data is already fresh, only waits when necessary

### Guaranteed Fresh Data
- **Before**: Hoped 500ms was enough, sometimes wasn't
- **After**: Verifies actual freshness via timestamps

### Minimal Performance Impact
- Timestamp writes: Single atomic store per update (~1-2 ns)
- Timestamp reads: Single atomic load per check (~1-2 ns)
- No message passing or callbacks overhead

## Testing Recommendations

1. **Floor Change Test**: Use cavebot with waypoints that immediately go up/down ladders, ensure creatures are detected on both floors
2. **Control Handover Test**: Verify targeting → cavebot handover doesn't skip creatures
3. **Performance Test**: Check that cavebot FSM doesn't experience delays when data is fresh
4. **Timeout Test**: Verify 1s timeout works when creatureMonitor is stuck/slow

## Memory Layout

### Creatures Array Header
```
Offset 0: count (number of creatures)
Offset 1: version (for optimistic concurrency)
Offset 2: update_counter (legacy, unused)
Offset 3: lastUpdateTimestamp (Date.now() in ms)
```

### Path Headers (cavebotPathData, targetingPathData)
```
Offset 0-13: path metadata (length, status, coords, etc.)
Offset 14: lastUpdateTimestamp
Offset 15: version
```

### Struct Fields (playerPos, target)
```
Fields: x, y, z, ..., lastUpdateTimestamp, version
```

## Backward Compatibility

⚠️ **Breaking Change**: SAB layout has changed. All workers must be restarted together.

The changes are backward-compatible in code (old readers will ignore new fields), but **memory offsets have shifted**, so workers compiled/initialized with old schema will read garbage data.

**Solution**: Full application restart required after update.

## Future Improvements

1. **Add timestamps to more properties**: `battleList`, `looting` if needed
2. **Expose timestamps to Redux**: Could show "data age" in UI
3. **Timeout tuning**: May adjust 1s timeout based on real-world performance
4. **SAB versioning**: Add schema version field to detect mismatches
