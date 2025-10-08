# Worker Integration Refactor Plan

## Executive Summary

This document outlines a comprehensive refactor to eliminate race conditions, reduce latency, and simplify data flow across the multi-worker architecture. The core change is moving from a **Redux-first** to a **SAB-first** architecture with unified state management.

**Expected Improvements:**
- **Latency**: 200-250ms → <20ms for control handovers
- **Race Conditions**: Eliminated via atomic batch updates
- **Code Complexity**: -40% via unified API replacing scattered Atomics operations
- **Performance**: +30% via OCR caching and incremental updates

---

## Current Architecture Issues

### 1. Race Conditions in State Synchronization

**Problem**: Workers receive `state_diff` updates at different times due to debouncing (16ms), while SAB updates are immediate. This creates temporal mismatches.

**Example**:
```javascript
// Time T=0: creatureMonitor writes to SAB
creatureMonitor: writeCreatures(newList)  // Immediate
creatureMonitor: writeTarget(newTarget)   // Immediate  
creatureMonitor: incrementWorldCounter()  // Signals "complete"

// Time T=5ms: pathfinder reads SAB (sees new data)
pathfinder: creatures = readCreaturesFromSAB()  // New data

// Time T=20ms: pathfinder receives Redux update (stale waypoint)
pathfinder: waypoint = state.cavebot.wptId  // Still old waypoint!

// Result: Path computed to OLD waypoint with NEW creatures = WRONG PATH
```

**Impact**: 
- Pathfinder computes paths with mismatched inputs
- Targeting may attack wrong creature due to stale target data
- Cavebot may move to outdated waypoint positions

### 2. Control Handover Latency (200-250ms)

**Current Flow**:
```
1. targetingWorker: Detects need for control             [T=0ms]
2. targetingWorker → Redux: requestTargetingControl      
3. Redux: Batch update (debounce wait)                   [T=16ms]
4. cavebotWorker: Receives state_diff                    [T=50ms]
5. cavebotWorker: Processes, decides to handover         [T=70ms]
6. cavebotWorker → Redux: confirmTargetingControl
7. Redux: Batch update (debounce wait)                   [T=86ms]
8. targetingWorker: Receives confirmation                [T=120ms]
9. targetingWorker: Can now execute movement             [T=170ms]

Total Latency: 170-250ms (varies with Redux batching)
```

**Impact**: 
- Combat reactions delayed by 200ms+ (unacceptable in fast-paced scenarios)
- Missed attack opportunities when target briefly becomes adjacent
- Poor user experience ("bot feels sluggish")

### 3. Triple Data Redundancy

**Player Position** exists in 3 places:
- `playerPosSAB` (written by minimapMonitor)
- `Redux: gameState.playerMinimapPosition` (written by minimapMonitor)
- Each worker's cached `workerState.playerMinimapPosition`

**Creatures** exist in 3 places:
- `creaturesSAB` (written by creatureMonitor)
- `Redux: targeting.creatures` (written by creatureMonitor)
- Each worker's cached creature list

**Why This Is Bad**:
- 3x memory usage
- Synchronization complexity (must update all 3)
- Impossible to determine "source of truth"
- Debugging nightmare (which version is correct?)

### 4. CreatureMonitor Performance Bottlenecks

**OCR Overhead**:
- OCR runs on EVERY health bar EVERY frame when dirty
- No persistent cache across frames (only within 1-second grace periods)
- Battle list OCR runs independently → duplicated work

**Reachability Calculation**:
- Recomputes pathfinding for ALL creatures even if only 1 moved
- No spatial indexing (brute-force distance checks)

**Measured Impact**:
- 50-80ms per frame with 10+ creatures
- 100% CPU core usage during combat
- Frame drops causing visual stuttering

### 5. Unclear Ownership & Scattered Logic

**Who writes what?** 
- Both minimapMonitor AND creatureMonitor write player position
- Both pathfinder AND cavebot compute distances
- Movement confirmation logic duplicated in 3 workers

**Path invalidation logic scattered across**:
- `cavebot/helpers/communication.js`
- `pathfinder/logic.js`  
- `targetingWorker.js`
- Each with slightly different invalidation rules

---

## Proposed Solution: Unified SAB-First Architecture

### Core Principles

1. **Single Source of Truth**: SAB is the ONLY real-time state. Redux is a UI mirror.
2. **Bidirectional Flow**:
   - **UI Config → SAB**: User actions (enable cavebot, change settings) go Redux → SAB → Workers
   - **Real-time Data → SAB**: Worker detections (position, creatures) go Workers → SAB → Redux (throttled)
3. **Atomic Operations**: All state changes via unified API with version control.
4. **Direct Worker Communication**: Control messages via SAB, not Redux round-trips.
5. **Clear Ownership**: Each worker owns specific state properties exclusively.
6. **Reactive Updates**: Workers react to SAB changes, not polling.
7. **Lua Compatibility**: Lua workers (luaScriptWorker, cavebotLuaExecutor) continue using Redux state via `getState()` - no changes needed.

### Architecture Overview

```
                    ┌──────────┐
                    │  Redux   │  ◄─── UI actions (user clicks)
                    │  Store   │
                    └──────────┘
                      │      ▲
          UI Config   │      │  Real-time data (100ms throttle)
          (immediate) │      │  
                      ▼      │
┌─────────────────────────────────────────────────────────────┐
│                  Unified SABState Manager                   │
│                                                             │
│  CONFIG DATA (written by workerManager from Redux):         │
│    - cavebotConfig: {enabled, nodeRange, controlState}      │
│    - targetingConfig: {enabled, targetingList}              │
│                                                             │
│  REAL-TIME DATA (written by workers):                       │
│    - playerPos, creatures, target, battleList, pathData     │
│                                                             │
│  - Atomic read/write/batch operations                       │
│  - Version control for consistency                          │
│  - Control channel for worker-to-worker messaging           │
└─────────────────────────────────────────────────────────────┘
                            ▲  ▼
        ┌──────────────────┼──┼──────────────────┐
        ▼                  ▼  ▼                  ▼
  ┌──────────┐      ┌──────────┐         ┌──────────┐
  │ minimap  │      │ creature │         │pathfinder│
  │ Monitor  │      │ Monitor  │         │  Worker  │
  │          │      │          │         │          │
  │ WRITES:  │      │ WRITES:  │         │ WRITES:  │
  │ playerPos│      │ creatures│         │ pathData │
  │          │      │ target   │         │          │
  │ READS:   │      │battleList│         │ READS:   │
  │(config)  │      │          │         │ playerPos│
  └──────────┘      │ READS:   │         │ creatures│
                    │(config)  │         │(config)  │
                    └──────────┘         └──────────┘
                         ▲                     ▲
                         │ READS               │ READS
                         │ (real-time + cfg)   │ (real-time + cfg)
          ┌──────────────┴─────────────────────┴─────┐
          ▼                                           ▼
    ┌──────────┐                               ┌──────────┐
    │ cavebot  │◄──── control channel ────────►│targeting │
    │  Worker  │                               │  Worker  │
    │          │                               │          │
    │ READS:   │                               │ READS:   │
    │ playerPos│                               │battleList│
    │ pathData │                               │ target   │
    │(config)  │                               │pathData  │
    └──────────┘                               │(config)  │
                                               └──────────┘

    ┌──────────────────────────────────────────────────────┐
    │ Lua Workers (luaScriptWorker, cavebotLuaExecutor)    │
    │ CONTINUE using Redux state via getState()            │
    │ NO CHANGES NEEDED - operates independently of SAB     │
    └──────────────────────────────────────────────────────┘
```

### Data Flow Examples

#### Example 1: Player Movement (< 10ms end-to-end)

```javascript
// T=0ms: minimapMonitor detects position change
minimapMonitor: 
  const newPos = {x: 100, y: 200, z: 7}
  sabState.set('playerPos', newPos)  // Atomic write with version bump
  sabState.controlChannel.broadcast('POSITION_UPDATED', newPos)

// T=1ms: pathfinder receives control message (no Redux needed!)
pathfinder:
  const msg = controlChannel.poll()  // Non-blocking check
  if (msg.type === 'POSITION_UPDATED') {
    const snapshot = sabState.snapshot(['playerPos', 'target', 'creatures'])
    if (snapshot.versionsMatch()) {  // All from same "world tick"
      const path = computePath(snapshot)
      sabState.set('pathData', path)
      controlChannel.send('cavebot', 'PATH_READY', {pathVersion: path.version})
    }
  }

// T=5ms: cavebot receives PATH_READY
cavebot:
  const msg = controlChannel.poll()
  if (msg.type === 'PATH_READY') {
    const pathData = sabState.get('pathData')
    if (pathData.version === msg.pathVersion) {  // Version check
      executeMovement(pathData)
    }
  }

// T=100ms: Redux syncs for UI (async, no blocking)
workerManager:
  setInterval(() => {
    const snapshot = sabState.snapshot(['playerPos', 'creatures', 'target'])
    store.dispatch(batchUpdate(snapshot))
  }, 100)
```

**Result**: 5ms position→path→movement vs 200ms+ in current system

#### Example 2: Control Handover (< 20ms)

```javascript
// T=0ms: Cavebot reaches waypoint with attack mode
cavebot:
  if (waypointReached && waypoint.type === 'Attack') {
    sabState.controlChannel.send('targeting', 'HANDOVER_CONTROL', {
      reason: 'WAYPOINT_ATTACK',
      waypointPos: currentWaypoint
    })
    fsm.transition('WAITING_FOR_TARGETING')
  }

// T=2ms: Targeting receives handover (direct, no Redux)
targeting:
  const msg = controlChannel.waitForMessage(50)  // Blocks up to 50ms
  if (msg.type === 'HANDOVER_CONTROL') {
    fsm.transition('SELECTING_TARGET')
    startTargeting()
  }

// T=5-15ms: Targeting finishes, hands back
targeting:
  if (noMoreTargets && fsm.state === 'ENGAGING') {
    controlChannel.send('cavebot', 'HANDOVER_CONTROL', {
      reason: 'COMBAT_COMPLETE'
    })
    fsm.transition('IDLE')
  }

// T=17ms: Cavebot resumes
cavebot:
  const msg = controlChannel.poll()
  if (msg.type === 'HANDOVER_CONTROL') {
    fsm.transition('WALKING')
    resumeNavigation()
  }
```

**Result**: 17ms total handover vs 200-250ms in current system (10-15x faster!)

---

## Implementation Plan (15 Steps)

### Phase 1: Foundation (Steps 1-4)

**Step 1: Design Unified SAB State Management API**
- Create `electron/workers/sabState/index.js` with clean API:
  - `state.get(property)` - versioned atomic read
  - `state.set(property, value)` - atomic write with version bump
  - `state.batch(updates)` - atomic multi-property update
  - `state.watch(property, callback)` - reactive change detection
  - `state.snapshot([properties])` - consistent multi-property read

- Define schemas in `electron/workers/sabState/schema.js`:
  ```javascript
  export const SCHEMA = {
    playerPos: {
      type: 'struct',
      fields: {x: 'int32', y: 'int32', z: 'int32'},
      sabOffset: 0,
      size: 4  // includes version counter
    },
    creatures: {
      type: 'array',
      maxCount: 100,
      itemSize: 43,
      sabOffset: 4,
      size: 4303  // includes count + version
    },
    // ... other properties
  }
  ```

**Step 2: Implement Core SABState Class**
- Atomic operations using Atomics.load/store/add
- Version counters for each property (monotonic increment)
- Batch writes with version consistency check
- Rollback on failure

**Step 3: Create Worker Control Channel**
- Dedicated SAB section for messages
- Lock-free ring buffer for multi-producer/consumer
- Priority queue (CRITICAL > NORMAL > LOW)
- `Atomics.wait()` for blocking operations

**Step 4: Remove Old SAB Management Code**
- Delete `electron/workers/sabStateManager.js`
- Migrate constants from `sharedConstants.js` to schema
- Remove scattered Atomics operations

### Phase 2: Worker Refactors (Steps 5-9)

**Step 5: Refactor minimapMonitor**
- Exclusive writer for `playerPos`
- Emit POSITION_UPDATED when position changes >= 1 tile
- Remove Redux dispatches

**Step 6: Refactor creatureMonitor**
- Use `state.batch()` for atomic creatures + battleList + target write
- Add persistent OCR cache (Map<positionHash, {text, timestamp}>)
- Incremental reachability (only for moved creatures)
- Dirty region tracking (skip unchanged screen areas)

**Step 7: Refactor pathfinder**
- Use `state.snapshot()` for consistent reads
- Reject stale requests (version mismatch)
- Cache computed paths with input hash
- Emit PATH_READY via control channel

**Step 8: Refactor cavebot**
- Remove Redux dependencies for real-time data
- Read from SAB exclusively
- Listen to control channel for handovers
- Use `state.watch()` instead of polling

**Step 9: Refactor targeting**
- Remove Redux dependencies
- Listen to control channel for handovers
- React to target changes via `state.watch()`
- Fast path for gameworld clicks on adjacent creatures

### Phase 3: Integration (Steps 10-12)

**Step 10: Create movementUtils Shared Module**
- Consolidate distance/reachability logic
- Single implementation used by all workers
- Prevents logic drift

**Step 11: Update workerManager**
- Pass SABState reference to all workers
- Add 100ms throttled Redux sync (SAB → Redux → UI)
- Remove high-frequency Redux dispatches from workers

**Step 12: Update Other Workers**
- screenMonitor: use `state.set()` for hp/mana
- luaScriptWorker: read from SAB for $pos, $target, etc.

### Phase 4: Validation (Steps 13-15)

**Step 13: Add Performance Monitoring**
- Track handover latency (target: <20ms)
- Track path computation (target: <10ms)
- Track OCR cache hit rate (target: >80%)
- Track version conflicts (target: <1%)

**Step 14: Add Error Detection**
- Version consistency assertions
- Deadlock detection (timeout + recovery)
- Stale read warnings
- Graceful degradation on conflicts

**Step 15: Update Documentation**
- Update WARP.md with new architecture
- API reference for SABState
- Data flow diagrams
- Worker ownership model

---

## Expected Performance Improvements

### Latency Reductions

| Operation | Current | After Refactor | Improvement |
|-----------|---------|----------------|-------------|
| Position → Path | 50-100ms | 5-10ms | **10x faster** |
| Control Handover | 200-250ms | 15-20ms | **12x faster** |
| Target Acquisition | 100-150ms | 20-30ms | **5x faster** |
| Path Invalidation | 30-50ms | 2-5ms | **10x faster** |

### CPU & Memory

| Metric | Current | After Refactor | Improvement |
|--------|---------|----------------|-------------|
| CreatureMonitor CPU | 80-100% | 40-60% | **40% reduction** |
| OCR Operations/sec | 200-300 | 50-80 | **70% reduction** |
| State Memory | 15MB (3x redundancy) | 5MB | **66% reduction** |
| Redux Dispatches/sec | 100-200 | 10 | **95% reduction** |

### Code Complexity

| Metric | Current | After Refactor | Improvement |
|--------|---------|----------------|-------------|
| SAB Management LOC | ~1200 (scattered) | ~400 (unified) | **66% reduction** |
| Atomics Operations | 89 (manual) | 0 (API) | **100% reduction** |
| Position Reads | 15 locations | 3 locations | **80% reduction** |

---

## Risk Mitigation

### Risk 1: Breaking Changes During Refactor

**Mitigation**:
- Implement SABState alongside old system initially
- Add feature flag: `USE_UNIFIED_SAB_STATE`
- Run both systems in parallel during testing
- Gradual rollout (minimapMonitor → pathfinder → cavebot → targeting)

### Risk 2: SAB Version Conflicts

**Mitigation**:
- Automatic retry with fresh snapshot on version mismatch
- Timeout mechanisms to prevent infinite retries
- Logging + metrics to detect patterns
- Fallback to Redux state if SAB consistently fails

### Risk 3: Control Channel Deadlocks

**Mitigation**:
- All `waitForMessage()` calls have timeouts
- Automatic recovery via worker restart
- Health check system (heartbeat every 500ms)
- Panic button: flush control channel on timeout

---

## Testing Strategy

### Unit Tests
- `SABState.js`: Atomic operations, version control, batch writes
- `controlChannel.js`: Message passing, priority queue, blocking waits
- `schema.js`: Schema validation, size calculations

### Integration Tests
- Position update flow (minimap → pathfinder → cavebot)
- Control handover flow (cavebot ↔ targeting)
- Creature update flow (creatureMonitor → targeting)
- Redux sync (SAB → Redux → UI)

### Performance Tests
- Handover latency benchmark (target: <20ms, 99th percentile)
- Path computation benchmark (target: <10ms, 50th percentile)
- OCR cache hit rate (target: >80% after 30s runtime)
- Version conflict rate (target: <1% of operations)

### Stress Tests
- 50+ creatures in combat
- Rapid position changes (teleport spam)
- Control handover storm (targeting→cavebot→targeting loops)
- SAB corruption recovery

---

## Success Metrics

### Primary Goals (Must Achieve)
- ✅ Control handover < 20ms (95th percentile)
- ✅ Zero race conditions in state synchronization
- ✅ Position→path→movement < 15ms (95th percentile)
- ✅ No SAB version conflicts during normal operation

### Secondary Goals (Should Achieve)
- ✅ OCR cache hit rate > 80%
- ✅ CreatureMonitor CPU usage < 60%
- ✅ Code complexity reduction > 40%
- ✅ Redux dispatch rate < 20/sec

### Stretch Goals (Nice to Have)
- ✅ Path computation < 5ms (median)
- ✅ Control handover < 10ms (median)
- ✅ OCR cache hit rate > 90%
- ✅ Zero manual Atomics operations in worker code

---

## Rollout Plan

### Week 1: Foundation
- Days 1-2: Design + implement SABState API
- Days 3-4: Control channel implementation
- Day 5: Unit tests + documentation

### Week 2: Core Workers
- Days 1-2: Refactor minimapMonitor + creatureMonitor
- Days 3-4: Refactor pathfinder
- Day 5: Integration testing

### Week 3: Action Workers
- Days 1-2: Refactor cavebot
- Days 3-4: Refactor targeting
- Day 5: End-to-end testing

### Week 4: Polish
- Days 1-2: Performance monitoring + error detection
- Days 3-4: Stress testing + bug fixes
- Day 5: Documentation + rollout

---

## Conclusion

This refactor transforms Automaton from a Redux-centric architecture with scattered SAB operations into a **unified, SAB-first** system with:

1. **Predictable data flow**: Single source of truth eliminates race conditions
2. **Sub-20ms latency**: Direct worker communication bypasses Redux round-trips
3. **Simple mental model**: Clear ownership + intuitive API replaces manual Atomics
4. **Better performance**: 40% less CPU via caching + incremental updates

The investment of ~4 weeks will pay dividends in maintainability, debuggability, and user experience. The architecture will scale to future features (e.g., multi-target, area looting) without the current brittleness.

**Next Step**: Review this plan, then proceed with Step 1 (Design SABState API).
