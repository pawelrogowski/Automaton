# Hotfix 2: Targeting Logic sabStateManager Reference

**Date:** 2025-10-09  
**Issue:** TargetingWorker crash with "sabStateManager is not defined"  
**Status:** ✅ FIXED

## Problem

After fixing the schema issue, another error appeared:
```
[ERROR] [TargetingWorker] Unhandled error in main loop: ReferenceError: sabStateManager is not defined
    at acquireTarget (file:///home/feiron/Dokumenty/Automaton/electron/workers/targeting/targetingLogic.js:206:21)
```

**Root Cause:** In `targeting/targetingLogic.js`, the `acquireTarget()` function had two direct references to `sabStateManager` that were missed during the migration:
- Line 206: `sabStateManager.getCreatures()`
- Line 216: `sabStateManager.getCurrentPlayerPosition()`

## Solution

Updated `acquireTarget()` function signature to accept callback functions instead of using `sabStateManager` directly:

### Before
```javascript
export function acquireTarget(
  getBattleList,
  parentPort,
  targetName,
  lastClickedIndex,
  globalState = null
) {
  const creatures = sabStateManager.getCreatures();  // ❌ Error!
  const playerPos = sabStateManager.getCurrentPlayerPosition();  // ❌ Error!
}
```

### After
```javascript
export function acquireTarget(
  getBattleList,
  parentPort,
  targetName,
  lastClickedIndex,
  globalState = null,
  getCreatures = null,  // ✅ New parameter
  getPlayerPosition = null  // ✅ New parameter
) {
  const creatures = getCreatures ? getCreatures() : [];
  const playerPos = getPlayerPosition ? getPlayerPosition() : null;
}
```

### Updated Call Site in targetingWorker.js

```javascript
const result = acquireTarget(
  getBattleListFromSAB,
  parentPort,
  pathfindingTarget.name,
  targetingState.lastAcquireAttempt.battleListIndex,
  workerState.globalState,
  getCreaturesFromSAB,  // ✅ Pass function
  () => workerState.playerMinimapPosition  // ✅ Pass function
);
```

## Files Modified

1. `electron/workers/targeting/targetingLogic.js` - Updated function signature and implementation
2. `electron/workers/targetingWorker.js` - Updated function call to pass new parameters

## Testing

### Build Status
```bash
$ npm run build
> webpack 5.99.9 compiled successfully in 9570 ms
```
✅ **Build successful**

### Expected Runtime Behavior

The targeting system should now:
- Successfully acquire targets by clicking battle list entries
- Use game world clicks when creatures are adjacent and stationary
- No more "sabStateManager is not defined" errors

## Why This Was Missed

These references were buried in the game world click logic (lines 206-216), which is conditional code that only executes when:
1. `GAMEWORLD_CONFIG.ENABLED` is true
2. Target creature is adjacent
3. Target creature has been stationary for > 300ms

This made it easy to miss during the initial migration since it's not the primary code path.

## Related

- **Main Migration:** `LEGACY_SAB_REMOVAL_COMPLETE_2025-10-09.md`
- **First Hotfix:** `HOTFIX_MISSING_SAB_PROPERTIES_2025-10-09.md`
