# State Management Analysis - Bottlenecks & Issues

## Overview
The system uses three state management systems:
1. **Redux** - Main state store (frontend + workerManager)
2. **Unified SAB** - SharedArrayBuffer for high-frequency worker data
3. **Legacy SABs** - Old per-feature SharedArrayBuffers

## Critical Issues Found

### 1. RACE CONDITION: Redux ↔ SAB Desynchronization

**Problem**: Workers write to BOTH SAB and Redux, but these operations are not atomic.

**Example (creatureMonitor.js lines 1426-1447)**:
```javascript
// Step 1: Write to SAB (atomic, versions bump)
sabInterface.batch({
  creatures: sabCreatures,
  battleList: sabBattleList,
  target: sabTarget,
});

// Step 2: Write to legacy SAB (separate system!)
sabStateManager.writeWorldState({...});

// Step 3: Send Redux updates (queued, processed 16ms later!)
parentPort.postMessage({ type: 'batch-update', payload: batchUpdates });
```

**Race condition timeline**:
```
T=0ms:   CreatureMonitor writes to SAB (versions: creatures=10, target=20)
T=0ms:   CreatureMonitor queues Redux update
T=5ms:   TargetingWorker reads SAB (gets version 10, 20)
T=10ms:  PathfinderWorker reads SAB (gets version 10, 20)
T=16ms:  Redux processes update (now frontend has stale data!)
T=20ms:  CreatureMonitor writes again (SAB versions: 11, 21)
T=20ms:  Redux still processing T=0 update!
```

**Result**: SAB is 2-3 updates ahead of Redux!

### 2. BOTTLENECK: 16ms Update Queue

**Location**: workerManager.js lines 1259-1290

```javascript
this.incomingActionQueue = [];
this.incomingActionInterval = setInterval(() => {
  if (this.incomingActionQueue.length > 0) {
    // Process queue every 16ms
  }
}, 16);
```

**Problem**:
- Workers send updates every ~5-50ms
- Queue processes every 16ms
- High-frequency workers (creatureMonitor, screenMonitor) can queue 3-5 updates before processing
- Coalescing logic (lines 1273-1284) drops intermediate updates
- **Data loss**: Intermediate state changes are silently discarded

**Example**:
```
T=0ms:   creatures=[Rat1] queued
T=5ms:   creatures=[Rat1, Rat2] queued (Rat2 appeared)
T=10ms:  creatures=[Rat2] queued (Rat1 died)
T=16ms:  Queue processes → coalescing keeps ONLY last: creatures=[Rat2]
         Frontend NEVER sees Rat1!
```

### 3. INCONSISTENCY: Multiple Update Sources

**Workers updating same data**:

| Data | SAB Writer | Redux Writer | Readers |
|------|------------|--------------|---------|
| creatures | creatureMonitor | creatureMonitor | targeting, cavebot, pathfinder |
| target | creatureMonitor | creatureMonitor | targeting, cavebot |
| playerPos | minimapMonitor | minimapMonitor | ALL workers |
| path (cavebot) | pathfinder | - | cavebot |
| path (targeting) | pathfinder | - | targeting |

**Problem**: No single source of truth!
- SAB has latest data
- Redux lags by 16ms
- Workers read from BOTH sources
- **Which one is correct?**

### 4. VERSION BUMP EXPLOSION

**Current behavior**:
```
CreatureMonitor iteration:
1. SAB batch write → 3 versions bump (creatures, battleList, target)
2. Legacy SAB write → 3 more versions bump
3. Redux updates → 7 action types dispatched
4. Each Redux action → slice version bumps

Total: 3 (SAB) + 3 (legacy) + 7 (Redux) = 13 version bumps per iteration!
```

**Frontend observes**: Version jumps by 2-7 between renders because:
- Multiple iterations happen between React renders (16.67ms @ 60fps)
- Coalescing drops intermediate states
- No correlation between SAB versions and Redux versions

### 5. PATHFINDER STALE DATA

**Issue**: Pathfinder reads creature positions from SAB, but targeting/cavebot might use stale Redux data for decisions.

**Example flow**:
```
T=0:   CreatureMonitor: Rat at (100, 100) → SAB
T=5:   Pathfinder: Reads SAB → calculates path to (100, 100)
T=10:  Rat moves to (105, 100) → SAB updated
T=16:  Redux: Rat at (100, 100) (stale!)
T=20:  Targeting: Reads Redux → decides to target based on (100, 100)
T=20:  Targeting: Sends move command based on OLD path
T=25:  Path stale check catches it → rejects path
```

**Result**: Path constantly rejected as "stale", movement stutters

### 6. DOUBLE BUFFERING NOT FULLY UTILIZED

**Problem**: Screen capture uses double buffering, but workers don't always respect it.

**creatureMonitor.js** (GOOD):
```javascript
// Line 636: Gets fresh buffer before each scan
sharedBufferView = getReadableBuffer();
battleListEntries = await processBattleListOcr(sharedBufferView, regions);
```

**But**: Multiple `getReadableBuffer()` calls in single iteration (lines 636, 651, 658, 820, 1214, 1290, 1298)

**Problem**: Each call might get a DIFFERENT buffer if swap happened!
- Battle list OCR from buffer A
- Health bar scan from buffer B
- Target scan from buffer A again

**Result**: Inconsistent frame data within single iteration

### 7. CONTROL STATE RACE CONDITION

**Location**: cavebot handover mechanism

```
T=0:   Targeting: creature dies
T=0:   Targeting: sends releaseTargetingControl
T=5:   Cavebot: controlState still "TARGETING" (Redux not updated yet)
T=10:  Cavebot: skips iteration (wrong control state)
T=16:  Redux: updates controlState to "CAVEBOT"
T=20:  Cavebot: finally takes control
T=100: Cavebot: waits for fresh playerPos (lines 287-318)
T=200: Cavebot: finally sends map click
```

**Total handover latency**: ~200ms
**Expected**: <50ms

### 8. MISSING ATOMICITY IN BATCH UPDATES

**SABState.batch()** (lines 143-168):
```javascript
batch(updates) {
  // Write all properties
  for (const [propertyName, value] of Object.entries(updates)) {
    this._writeStruct(schema, offset, value);  // ← Not atomic!
  }
  
  // Increment all versions
  for (const propertyName of Object.keys(updates)) {
    this._incrementVersion(propertyName);  // ← Separate loop!
  }
}
```

**Problem**: Another worker can read BETWEEN write and version increment!

**Should be**:
```javascript
// Atomic: write + increment version TOGETHER for each property
for (const [propertyName, value] of Object.entries(updates)) {
  this._writeStruct(schema, offset, value);
  this._incrementVersion(propertyName);  // ← Immediate!
}
```

### 9. PERFORMANCE: Unnecessary State Propagation

**workerManager.js getStateChanges()** - sends FULL slices to ALL workers even for tiny changes

**Example**: Battle list gains 1 creature
- Redux: Entire `targeting` slice sent to 3 workers
- Size: ~5KB
- Frequency: 20-50 times/second
- **Bandwidth**: 100-250 KB/s just for state distribution!

**Better**: Send diffs or use SAB exclusively for high-frequency data

### 10. LOOP TIMING INCONSISTENCIES

| Worker | Loop Interval | SAB Reads | Redux Writes | Notes |
|--------|---------------|-----------|--------------|-------|
| creatureMonitor | ~25ms | Every iteration | 1-7/iteration | Heaviest writer |
| targeting | 50ms | Every iteration | 1-3/iteration | |
| cavebot | 25ms | Every iteration | 0-2/iteration | |
| pathfinder | On-demand | Never | 0 | Only writes SAB |
| minimapMonitor | ~16ms | Never | 1/iteration | Position updates |
| screenMonitor | ~25ms | Never | 3-10/iteration | Rule triggers |

**Problem**: No synchronization!
- Workers run at different frequencies
- No "tick" synchronization
- Data written by one worker might not be read by another for 50ms

## Recommendations

### HIGH PRIORITY

1. **Eliminate Redux for High-Frequency Data**
   - Move creatures, target, playerPos, paths to SAB-only
   - Use Redux ONLY for config and UI state
   - Reduces update volume by 90%

2. **Fix SAB Batch Atomicity**
   - Write + version increment must be atomic per property
   - Prevents torn reads

3. **Implement Proper Buffer Snapshotting**
   - Get buffer ONCE per iteration
   - Store in variable, use throughout
   - Ensures frame consistency

4. **Reduce Queue Interval**
   - Change from 16ms to 8ms or 5ms
   - Or eliminate queue entirely for critical updates

5. **Unify Control State in SAB**
   - Put control state in SAB for instant access
   - No more waiting for Redux propagation

### MEDIUM PRIORITY

6. **Add Version Correlation**
   - Track which SAB version corresponds to which Redux dispatch
   - Detect desynchronization

7. **Implement Incremental State Distribution**
   - Send only changed slices to workers
   - Or use SAB watchers instead

8. **Synchronize Worker Ticks**
   - Add global "tick" counter in SAB
   - Workers wait for next tick before processing
   - Ensures consistent data snapshots

### LOW PRIORITY

9. **Remove Legacy SABs**
   - Migrate fully to unified SAB
   - Reduces confusion and duplicate writes

10. **Add State Flow Monitoring**
    - Track update latencies
    - Detect version drift
    - Alert on consistency violations

## Immediate Actions

1. ✅ **DONE**: Batch creatureMonitor Redux updates
2. **TODO**: Fix SAB batch atomicity
3. **TODO**: Single buffer snapshot per iteration
4. **TODO**: Move control state to SAB
5. **TODO**: Reduce/eliminate queue for critical updates
