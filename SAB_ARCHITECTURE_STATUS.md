# Unified SAB Architecture Status

## Goal
Workers should read data primarily from unified SAB, not from Redux state diffs. Redux should only receive updates FROM workers for UI display, not BE the source of truth for worker communication.

## Current Status (After Latest Changes)

### ✅ Fully Migrated to Unified SAB

#### **Player Position Flow**
- **Writer**: MinimapMonitor → `playerPos` (SAB)
- **Readers**: Cavebot, Pathfinder, Targeting → read from `playerPos` (SAB)
- **UI Sync**: WorkerManager syncs SAB → Redux for UI display
- **Status**: ✅ Complete

#### **Path Data Flow**
- **Writer**: Pathfinder → `pathData` (SAB) with complete header fields
- **Reader**: Cavebot → reads from `pathData` (SAB) including wptId/instanceId
- **UI Sync**: WorkerManager syncs SAB → Redux for UI display
- **Status**: ✅ Complete (fixed in this session)

#### **Creature Data Flow**
- **Writer**: CreatureMonitor → `creatures`, `battleList`, `target` (SAB)
- **Readers**: Targeting, Cavebot → read from SAB
- **UI Sync**: WorkerManager syncs SAB → Redux for UI display
- **Status**: ✅ Complete

#### **Configuration Flow (Simple)**
- **Writer**: WorkerManager → `cavebotConfig`, `targetingConfig`, `globalConfig` (SAB)
  - Syncs on Redux store changes (immediate)
- **Readers**: Pathfinder reads `cavebotConfig.wptId` from SAB (primary source)
- **Status**: ✅ Partially complete (simple config fields only)

### ⏳ Hybrid State (Transitional)

#### **Complex Configuration Data**
These remain in Redux state diffs for now (complex nested structures):
- **Cavebot**: `waypointSections`, `dynamicTarget`, `specialAreas`, `temporaryBlockedTiles`
- **Targeting**: `targetingList` (array of complex rules)

**Reasoning**:
1. Complex nested structures not yet modeled in SAB schema
2. Lower change frequency (acceptable to use Redux diffs)
3. Can be migrated later as Phase 3

**Impact**: Workers receive both SAB data AND selective Redux diffs for complex config

### ❌ Legacy Systems (To Be Removed)

#### **Legacy SAB Arrays**
- **Status**: ✅ **REMOVED FROM ALL CORE WORKERS** (2025-10-08)
  - **Cavebot**: ~150 lines removed (see `CAVEBOT_LEGACY_REMOVAL.md`)
  - **MinimapMonitor**: ~10 lines removed (legacy writes eliminated)
  - **CreatureMonitor**: ~20 lines removed (legacy writes eliminated)
  - **Pathfinder**: Already clean (unified SAB only)
  - **Targeting**: Already clean (unified SAB only)
  - See `LEGACY_SAB_CLEANUP_2025-10-08.md` for full details
- **Action**: ⏳ Optional cleanup in workerManager (buffer allocations can be removed)

#### **Redux State Diffs for Real-Time Data**
Workers still receive some Redux diffs, but now ignore them:
- Workers prioritize SAB reads over Redux data
- **Action**: Clean up worker message handlers to ignore redundant diffs

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Redux Store (UI Source)                 │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ gameState    │  │ cavebot       │  │ targeting       │  │
│  │ (position)   │  │ (config+data) │  │ (creatures)     │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
└───────┬───────────────────┬────────────────────┬────────────┘
        │ ↓ Config sync     │ ↑ UI sync          │ ↑ UI sync
        │ (immediate)       │ (throttled 100ms)  │
┌───────┴───────────────────┴────────────────────┴────────────┐
│            WorkerManager (Orchestrator)                      │
│  • Redux → SAB sync (config changes)                         │
│  • SAB → Redux sync (real-time data for UI)                 │
└─────┬────────────────────────────────────┬──────────────────┘
      │                                    │
      ↓ Writes config                     ↑ Reads real-time data
┌─────────────────────────────────────────────────────────────┐
│              Unified SharedArrayBuffer (Source of Truth)     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐ │
│  │playerPos │ │ pathData │ │creatures │ │ cavebotConfig  │ │
│  │(realtime)│ │(realtime)│ │(realtime)│ │ (config)       │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘ │
└───┬────────────┬─────────────┬────────────┬─────────────────┘
    │            │             │            │
    ↓ Reads     ↓ Writes      ↓ Writes    ↓ Reads
┌────────┐  ┌────────────┐  ┌──────────────┐
│Cavebot │  │Pathfinder  │  │CreatureMonitor│
│        │  │            │  │              │
│• Reads │  │• Reads SAB │  │• Writes SAB  │
│  path  │  │• Writes    │  │              │
│• Reads │  │  path      │  │              │
│  pos   │  │            │  │              │
└────────┘  └────────────┘  └──────────────┘
```

## Benefits Achieved

1. **Reduced IPC Overhead**: High-frequency data (position, creatures) no longer floods IPC
2. **Lock-Free Reads**: Workers read SAB directly without waiting for Redux updates
3. **Consistent State**: Version-controlled atomic reads prevent torn reads
4. **Decoupling**: Workers don't depend on Redux store structure
5. **Performance**: Zero-copy data sharing for large arrays (waypoints, creatures)

## Fixes Applied in This Session

### Problem Identified
Workers were reading SAB interface incorrectly:
- `sabInterface.get()` returns `{ data: actualData, version: number }`
- Workers were accessing properties directly on result without unwrapping `.data`

### Files Fixed

1. **`electron/workers/cavebot/helpers/communication.js`**
   - Fixed playerPos read to unwrap `.data` property
   - Fixed pathData read to unwrap `.data` property
   - **Added**: Store `wptId` and `instanceId` from pathData (critical fix!)
   - Fixed missing `else if` for legacy SAB fallback

2. **`electron/workers/targetingWorker.js`**
   - Fixed `getCreaturesFromSAB()` to unwrap `.data`
   - Fixed `getCurrentTargetFromSAB()` to unwrap `.data`

3. **`electron/workers/pathfinder/logic.js`**
   - **Added**: Read `cavebotConfig` from unified SAB as primary source
   - **Added**: Use `cavebotConfig.wptId` instead of Redux `cavebot.wptId`
   - Added complete header fields when writing pathData
   - Fixed chebyshev distance calculation
   - Added comprehensive debug logging

## Testing Checklist

- [ ] Cavebot walks to waypoints correctly
- [ ] Targeting selects and attacks creatures
- [ ] Path visualization in UI matches actual path
- [ ] No "hash mismatch" errors in logs
- [ ] Debug logs show SAB reads succeeding:
  - `[Pathfinder] Read from SAB: wptId=...`
  - `[Cavebot] Read path from SAB: X waypoints, status: Y, wptId: Z`
  - `[Pathfinder] Wrote path to SAB: X waypoints, status: Y`

## Next Steps (Future Phases)

### Phase 3: Migrate Complex Config to SAB
- Model `waypointSections` in SAB schema
- Model `targetingList` rules in SAB schema
- Model `dynamicTarget` structure in SAB

### Phase 4: Remove Legacy Systems
- Remove legacy SAB arrays (playerPosSAB, pathDataSAB, etc.)
- Remove Redux state diff handling for migrated data
- Keep only SAB → Redux sync for UI

### Phase 5: Control Channel Usage
- Use control channel for handover coordination
- Use for critical events (floor change, teleport)
- Document usage patterns to prevent buffer overflow

## Architecture Patterns Confirmed

### Correct SAB Interface Usage
```javascript
// ✅ CORRECT - Unwrap .data property
const result = sabInterface.get('propertyName');
if (result && result.data) {
  const actualData = result.data;
  // Use actualData...
}

// ❌ INCORRECT - Missing .data unwrapping  
const data = sabInterface.get('propertyName');
if (data && data.someField) {  // Won't work!
  // ...
}
```

### Data Categories
1. **CONFIG** (workerManager → SAB → workers): Simple config fields, low-frequency updates
2. **REALTIME** (workers → SAB → Redux): High-frequency data, zero-copy sharing
3. **CONTROL** (workers → SAB → workers): Inter-worker coordination messages

This architecture provides a clean separation of concerns and optimizes performance for high-frequency game automation.
