# Screen Monitor Optimization - January 2025

## Problem Identified

The `screenMonitor` worker was sending Redux state updates **every scan cycle** (~50ms / 20Hz) regardless of whether the monitored values actually changed. This resulted in:

- **~1,200 redundant Redux updates per minute** when game state was static
- Unnecessary workerManager processing overhead
- Wasted CPU cycles on Redux state diff calculations
- Unnecessary IPC message broadcasts to all workers

## Root Cause

In `electron/workers/screenMonitor.js`, the worker would unconditionally send updates:

```javascript
// OLD CODE (line 609)
reusableGameStateUpdate.payload = { hppc, mppc, monsterNum, ... };
parentPort.postMessage(reusableGameStateUpdate); // ← Sent EVERY cycle!
```

## Solution Implemented

Added **change detection** before sending Redux updates. The worker now:

1. Builds the new payload
2. Compares it against the last sent payload
3. Only sends update if values actually changed

### Changes Made

**File:** `electron/workers/screenMonitor.js`

1. **Added tracking variable** (line 56):
   ```javascript
   let lastSentPayload = null;
   ```

2. **Added change detection logic** (lines 615-633):
   ```javascript
   const payloadChanged = !lastSentPayload || (
     newPayload.hppc !== lastSentPayload.hppc ||
     newPayload.mppc !== lastSentPayload.mppc ||
     newPayload.monsterNum !== lastSentPayload.monsterNum ||
     newPayload.healingCd !== lastSentPayload.healingCd ||
     newPayload.supportCd !== lastSentPayload.supportCd ||
     newPayload.attackCd !== lastSentPayload.attackCd ||
     newPayload.isWalking !== lastSentPayload.isWalking ||
     JSON.stringify(newPayload.characterStatus) !== JSON.stringify(lastSentPayload.characterStatus) ||
     JSON.stringify(newPayload.partyMembers) !== JSON.stringify(lastSentPayload.partyMembers) ||
     JSON.stringify(newPayload.activeActionItems) !== JSON.stringify(lastSentPayload.activeActionItems) ||
     JSON.stringify(newPayload.equippedItems) !== JSON.stringify(lastSentPayload.equippedItems)
   );

   if (payloadChanged || !hasScannedInitially) {
     reusableGameStateUpdate.payload = newPayload;
     parentPort.postMessage(reusableGameStateUpdate);
     lastSentPayload = newPayload;
   }
   ```

3. **Reset on region changes** (line 704):
   ```javascript
   lastSentPayload = null; // Force update on next scan after region change
   ```

## Comparison Strategy

The optimization uses a **hybrid comparison approach**:

- **Primitive values** (hppc, mppc, cooldowns, etc.): Direct equality comparison (`===`)
- **Object values** (characterStatus, equippedItems, etc.): JSON.stringify comparison

This is more efficient than deep object comparison while still being reliable for this use case.

## Expected Impact

### Before Optimization
- Redux updates: **~1,200/minute** (constant)
- Many updates when nothing changes

### After Optimization
- Redux updates: **Only when state changes**
- Typical scenarios:
  - **Idle/standing**: ~5-10 updates/minute (walking state, occasional scans)
  - **Combat**: ~100-200 updates/minute (HP/MP changes, cooldowns)
  - **Walking**: ~20-40 updates/minute (position changes)

### Performance Improvements
- **80-95% reduction** in Redux updates during idle periods
- Reduced CPU usage in workerManager
- Less IPC overhead
- Lower memory pressure from Redux state diffing

## Monitoring

To verify the optimization is working, check:

1. Worker Manager logs for reduced update frequency
2. CPU usage of main process during idle periods
3. Redux state update metrics (if you add performance logging)

## Testing Recommendations

1. **Idle test**: Stand still in-game for 30 seconds
   - Before: ~600 updates
   - After: ~5-15 updates

2. **Combat test**: Engage in combat
   - Should still update correctly on HP/MP changes
   - Cooldowns should trigger updates immediately

3. **Walking test**: Walk around continuously
   - Should update when position changes
   - Walking state should toggle correctly

## Related Workers Already Optimized

The following workers already had proper change detection:

- ✅ **windowTitleMonitor** - Uses `lastKnownLiveName` tracker
- ✅ **creatureMonitor** - Uses `postUpdateOnce()` with JSON stringify
- ✅ **ocrWorker** - Uses checksum-based change detection
- ✅ **pathfinderWorker** - Uses SAB + throttled Redux updates
- ✅ **minimapMonitor** - Only updates on position change

## Implementation Notes

### Why Not JSON.stringify Everything?

We use direct comparison for primitives because:
- It's faster (no serialization overhead)
- These values change most frequently (HP/MP every few seconds)
- Avoid unnecessary JSON.stringify calls in the hot path

### Why JSON.stringify for Objects?

Objects like `characterStatus` and `equippedItems`:
- Change less frequently
- Have simple structures (no nested complexity)
- JSON.stringify is fast enough for these cases
- Avoids implementing custom deep comparison logic

### Thread Safety

No thread safety concerns because:
- All variables are worker-local
- No shared state between workers
- Redux updates are serialized through IPC

## Future Optimizations

Potential further improvements (not critical):

1. **Cache JSON strings**: Pre-compute JSON.stringify for objects and compare cached strings
2. **Debounce updates**: Add 16ms debounce to batch rapid changes
3. **Checksum comparison**: Use numeric checksums instead of JSON.stringify for objects

However, the current implementation provides excellent performance with minimal complexity.

---

**Date:** January 14, 2025  
**Author:** Automated optimization based on worker analysis  
**Status:** ✅ Implemented and ready for testing
