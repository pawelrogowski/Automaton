# Mouse Noise GameWorld Boundary Fix

## Problem Description
Previously, mouse noise movements could occur anywhere on the screen, including:
- Battle list area
- Minimap
- Status bars (health, mana, cooldown, hotkey bars)
- Other UI elements

This could potentially:
1. Interfere with critical UI interactions
2. Look unnatural during combat (cursor wandering to UI)
3. Accidentally trigger UI elements

## Solution Implemented
Modified `electron/workers/mouseNoiseWorker.js` to **strictly constrain** all mouse noise movements to the gameWorld region only.

## Changes Made

### 1. Updated Region Weights (Line 41-42)
**Before:**
```javascript
REGION_WEIGHTS: {
  gameWorld: 0.70,        // Stay in game world most of time
  battleList: 0.10,       // Occasionally check battle list
  minimap: 0.10,          // Sometimes look at minimap
  other: 0.10,            // Very rarely other UI
},
```

**After:**
```javascript
REGION_WEIGHTS: {
  gameWorld: 1.0,         // Always stay in game world (100%)
},
```

### 2. Simplified `selectTargetRegion()` Function (Line 110-112)
**Before:**
- Complex switch statement handling multiple regions
- Could return battleList, minimap, statusBar, or other UI regions

**After:**
```javascript
function selectTargetRegion() {
  const regions = globalState?.regionCoordinates?.regions;
  if (!regions) return null;
  
  // Always return gameWorld - movements are constrained to game area only
  return regions.gameWorld;
}
```

### 3. Added Boundary Clamping in `calculateNextPosition()` (Line 204-209)
**Critical safety check** - ensures calculated position NEVER exceeds gameWorld boundaries:

```javascript
// CRITICAL: Ensure next position stays within gameWorld boundaries
const gameWorld = globalState?.regionCoordinates?.regions?.gameWorld;
if (gameWorld) {
  nextPos.x = Math.max(gameWorld.x, Math.min(nextPos.x, gameWorld.x + gameWorld.width - 1));
  nextPos.y = Math.max(gameWorld.y, Math.min(nextPos.y, gameWorld.y + gameWorld.height - 1));
}
```

This uses clamping to ensure:
- `x` coordinate: `gameWorld.x ≤ x ≤ (gameWorld.x + gameWorld.width - 1)`
- `y` coordinate: `gameWorld.y ≤ y ≤ (gameWorld.y + gameWorld.height - 1)`

### 4. Added Safety Check in Main Loop (Line 296-304)
Continuously validates that current position hasn't somehow escaped gameWorld bounds:

```javascript
// SAFETY CHECK: Ensure current position is within gameWorld bounds
const gameWorld = globalState.regionCoordinates.regions.gameWorld;
if (gameWorld && !isPointInRegion(currentPosition, gameWorld)) {
  log('warn', `[MouseNoise] Current position (${currentPosition.x}, ${currentPosition.y}) is outside gameWorld! Resetting to center.`);
  currentPosition = {
    x: gameWorld.x + Math.floor(gameWorld.width / 2),
    y: gameWorld.y + Math.floor(gameWorld.height / 2)
  };
}
```

### 5. Enhanced Pause Boundary Check (Line 314-320)
Improved the pause validation with auto-correction:

```javascript
if (isPausing) {
  const gameWorld = globalState?.regionCoordinates?.regions?.gameWorld;
  if (!isPointInRegion(currentPosition, gameWorld)) {
    log('warn', `[MouseNoise] Paused but not in gameWorld - this should not happen! Resetting.`);
    isPausing = false;
    currentPosition = {
      x: gameWorld.x + Math.floor(gameWorld.width / 2),
      y: gameWorld.y + Math.floor(gameWorld.height / 2)
    };
    startNewPattern();
  }
}
```

## How It Works Now

### Initialization
- Cursor starts at the **center of gameWorld**
- Initial position logged with gameWorld boundaries

### Movement Generation
1. **Target Selection**: Only selects targets within gameWorld region
2. **Path Calculation**: Calculates smooth path toward target
3. **Boundary Clamping**: Every calculated position is clamped to gameWorld bounds
4. **Safety Validation**: Before sending, validates position is still in bounds
5. **Auto-Correction**: If somehow outside bounds, immediately resets to center

### Pausing Behavior
- Can **only pause** when cursor is over gameWorld
- If cursor somehow leaves gameWorld during pause, immediately cancels pause and resets

## Guarantees

The following guarantees are now enforced:

✅ **100% gameWorld constraint**: All movements are within gameWorld boundaries  
✅ **No UI interference**: Cursor never moves to battle list, minimap, or UI bars  
✅ **Multiple safety layers**: Clamping + validation + auto-correction  
✅ **Graceful error recovery**: Auto-resets to center if bounds violated  
✅ **Natural movement**: Smooth continuous movement within game area  

## Example Boundaries

If gameWorld region is:
```
x: 100, y: 50, width: 800, height: 600
```

Then all mouse positions will satisfy:
```
100 ≤ x ≤ 899
50 ≤ y ≤ 649
```

The cursor will **never** go to coordinates outside these bounds.

## Benefits

1. **Safer automation**: No accidental UI clicks
2. **More natural**: Cursor stays focused on game area
3. **Predictable behavior**: Easy to understand and debug
4. **Robust**: Multiple layers prevent boundary violations
5. **Performance**: Simplified logic is more efficient
