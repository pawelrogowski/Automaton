# Next Session Quick Start Guide

## Current Status

✅ **Phase 1 Complete:** Foundation (SABState, ControlChannel, workerManager integration)  
🚧 **Phase 2 In Progress:** Worker refactors (2 of ~8 complete)

### Completed Workers
- ✅ minimapMonitor (position authority)
- ✅ pathfinder (snapshot reads, path writes)

---

## Quick Start Commands

### 1. Check Current State
```bash
cd /home/feiron/Dokumenty/Automaton
cat IMPLEMENTATION_PROGRESS.md | head -50
read_todos
```

### 2. Test Current Implementation
```bash
npm run start
# Move character around to test position updates
# Check for errors in console
```

---

## Next Worker to Refactor: creatureMonitor

### Why This Worker Next?
- High performance impact (OCR caching opportunity)
- Complex: writes creatures, battleList, AND target atomically
- Used by both cavebot and targeting workers

### File to Modify
`electron/workers/creatureMonitor.js` (or creature monitor directory if split)

### Refactor Pattern

```javascript
// 1. Import at top
import { createWorkerInterface, WORKER_IDS } from './sabState/index.js';

// 2. Initialize in worker startup
let sabInterface = null;
if (workerData.unifiedSAB) {
  sabInterface = createWorkerInterface(workerData.unifiedSAB, WORKER_IDS.CREATURE_MONITOR);
  console.log('[CreatureMonitor] Unified SAB interface initialized');
}

// 3. Batch write all creature data atomically
if (sabInterface) {
  sabInterface.batch({
    creatures: detectedCreatures,      // array of creature objects
    battleList: battleListData,        // filtered/sorted list
    target: currentTarget,             // selected target
  });
}

// 4. Add OCR cache (performance optimization)
const ocrCache = new Map(); // key: `${x},${y},${z}`, value: {name, hp, timestamp}

// Invalidate cache when player moves (read from SAB)
const currentPlayerPos = sabInterface.get('playerPos');
if (hasPlayerMoved(currentPlayerPos, lastPlayerPos)) {
  clearOCRCache();
}
```

---

## Critical Patterns Established

### ✅ DO: Read Directly from SAB
```javascript
const pos = sabInterface.get('playerPos');
const snapshot = sabInterface.snapshot(['playerPos', 'pathData']);
```

### ❌ DON'T: Broadcast High-Frequency Data
```javascript
// BAD - causes buffer overflow
sabInterface.broadcast(CONTROL_COMMANDS.CREATURES_UPDATED, {...});
```

### ✅ DO: Batch Related Writes
```javascript
sabInterface.batch({
  creatures: [...],
  battleList: [...],
  target: {...},
});
```

---

## Testing Checklist

### After Each Worker Refactor

1. **Startup Test**
   ```bash
   npm run start 2>&1 | grep -E "(Worker|SAB|error|Error)" | head -50
   ```
   - ✅ Worker initializes
   - ✅ "Unified SAB interface initialized" appears
   - ✅ No import errors

2. **Runtime Test**
   - ✅ Move character (position updates work)
   - ✅ Enable cavebot (config propagates)
   - ✅ No "Buffer full" errors
   - ✅ No crashes or exceptions

3. **Legacy Compatibility**
   - ✅ UI still displays data
   - ✅ Redux state updates
   - ✅ Old SABs still work

---

## Common Issues & Solutions

### Issue: "X is not defined"
**Cause:** Variable scope problem  
**Solution:** Move variable declaration outside conditional blocks if needed by multiple code paths

### Issue: "[ControlChannel] Buffer full"
**Cause:** Broadcasting too frequently  
**Solution:** Remove broadcasts for high-frequency data, workers read from SAB directly

### Issue: "Cannot read property 'then' of null"
**Cause:** Async function returning null  
**Solution:** Add null checks or default values

### Issue: Import errors for SABState/ControlChannel
**Cause:** Circular dependencies or wrong import syntax  
**Solution:** Import at top of index.js, then export

---

## File Locations Quick Reference

```
electron/workers/sabState/
├── schema.js          # SAB property definitions
├── SABState.js        # Core state manager
├── controlChannel.js  # Worker messaging
└── index.js           # Exports and createWorkerInterface()

electron/workers/
├── minimapMonitor.js  # ✅ Position authority
├── pathfinder/        # ✅ Snapshot reads
├── creatureMonitor.js # ⏳ Next to refactor
├── cavebot/           # ⏳ After creatureMonitor
└── targetingWorker.js # ⏳ After cavebot
```

---

## Performance Targets

After full Phase 2 completion:

- Config updates: **<1ms** ✅ (already achieved)
- Position reads: **<0.1ms** ✅ (already achieved)
- Control handover: **<20ms** (target)
- Path computation: **<10ms** (target)
- OCR cache hit rate: **>80%** (target)
- Redux dispatches: **~10/sec** (target, from 100-200/sec)

---

## Key Files to Review

1. `IMPLEMENTATION_PROGRESS.md` - Detailed progress log
2. `SESSION_SUMMARY.md` - Today's work summary
3. `electron/workers/sabState/schema.js` - SAB property schemas
4. `electron/workers/minimap/processing.js` - Reference implementation (write)
5. `electron/workers/pathfinder/logic.js` - Reference implementation (read)

---

## Git Status

Check what's changed:
```bash
git status
git diff electron/workers/
```

Consider committing after each worker refactor:
```bash
git add electron/workers/minimap/
git commit -m "refactor: minimapMonitor uses unified SAB"

git add electron/workers/pathfinder/
git commit -m "refactor: pathfinder uses unified SAB with snapshot reads"
```

---

## Questions to Answer Next Session

1. Should we increase control channel buffer size from 32 to 64 messages?
   - Current answer: No, fix usage pattern instead

2. When to remove legacy SAB code?
   - After all workers refactored and tested

3. Should we add metrics collection now?
   - Wait until more workers refactored to get meaningful data

---

## Success Criteria for Phase 2

- [ ] All workers use unified SAB API
- [ ] No direct Atomics operations in workers
- [ ] Control channel only for coordination
- [ ] Config updates <1ms
- [ ] Control handover <20ms
- [ ] No buffer overflow errors
- [ ] Redux dispatch rate reduced by 90%+

**Current Progress: 2/8 workers complete (25%)**

---

## Contact/Support

If stuck, check:
1. `WARP.md` for project architecture
2. `IMPLEMENTATION_PROGRESS.md` for detailed history
3. Error logs in terminal output
4. SABState.js for API reference
