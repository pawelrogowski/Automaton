# Cursor Return Position Feature

**⚠️ NOTE: This document describes the original implementation. See `RANDOMIZED_CURSOR_BEHAVIOR.md` for the current enhanced version with 3 behaviors (50% game world, 35% wiggle, 15% minimap drift).**

## Problem Solved

When clicking on battle list entries, the cursor would:
1. **Hover interference** - Remain on battle list, messing with detection
2. **UI hover effects** - Trigger tooltips, highlights on other UI elements
3. **Pattern risk** - Predictable cursor behavior

## Solution: Extended Game World Area

After clicking a battle list entry, the cursor now moves to a **randomized position within the game world area plus 125px margins on left and right**.

### Positioning Strategy

**Horizontal (X)**: Game world width + 125px margins
- Extended 125px left of game world
- Extended 125px right of game world
- **Result**: Cursor can land in game world OR just outside it

**Vertical (Y)**: Full game world height
- Anywhere from top to bottom of game world
- Maximum vertical randomization
- **Result**: Huge variety of possible positions

### Visual Example
```
        ┌─────────────────────────────────┐
        │                                 │
        │        Game World Area         │
    125px   │                                 │   125px
  ←──────→  │  Cursor can land anywhere    │  ←──────→
   margin   │  in this entire area         │   margin
        │  (game world + margins)      │
        │                                 │
        └─────────────────────────────────┘
```

## Implementation

### C++ Native Module

Added optional `returnPosition` parameter:
```cpp
leftClick(windowId, x, y, display, [maxDuration], [returnPosition])
// returnPosition = {x: number, y: number}
```

### JavaScript Calculation

```javascript
function getRandomGameWorldPosition(sabStateManager) {
  const gameWorld = regions.gameWorld;
  
  // Horizontal: game world + 125px margins on each side
  const horizontalMargin = 125;
  const extendedX = gameWorld.x - horizontalMargin;
  const extendedWidth = gameWorld.width + (horizontalMargin * 2);
  const x = extendedX + Math.floor(Math.random() * extendedWidth);
  
  // Vertical: anywhere within full game world height
  const y = gameWorld.y + Math.floor(Math.random() * gameWorld.height);
  
  return { x, y };
}
```

## Randomization Analysis

### Example: 800x600 Game World

**Horizontal Range**:
- Width: 800px
- Margins: 125px each side (fixed)
- Total width: 800 + 250 = 1050px
- **Possible X positions**: 1050

**Vertical Range**:
- Height: 600px
- Full range: 0 to 600px
- **Possible Y positions**: 600

**Total Combinations**: 1050 × 600 = **630,000 unique positions**

### Every Click is Different

```
Click 1 → (234, 487)  // Left side, bottom area
Click 2 → (678, 115)  // Right side, top area
Click 3 → (412, 356)  // Middle, center area
Click 4 → (789, 542)  // Far right, lower area
Click 5 → (156, 98)   // Far left, upper area
Click 6 → (-50, 300)  // LEFT MARGIN (outside game world!)
Click 7 → (950, 450)  // RIGHT MARGIN (outside game world!)
...
```

**No pattern detectable!**

## Why This Works

### Avoids UI Hover Effects ✅

**Top UI Elements** (avoided):
- Menu bar
- Buttons
- Tabs
- Character info panels

**Bottom UI Elements** (avoided):
- Status bars
- Chat
- Action bars
- Any bottom panels

**Side UI Elements** (10% margin):
- Inventory
- Minimap
- Battle list itself!

### Looks Natural ✅

Real players:
- Watch center of screen (where action happens)
- Don't stare at UI edges
- Cursor naturally hovers in middle area
- Position varies based on what they're watching

### Completely Random ✅

```
Pattern Analysis:
├─ X coordinate: Unpredictable ✅
├─ Y coordinate: Unpredictable ✅
├─ Distance from last: Variable ✅
├─ Direction: No pattern ✅
└─ Timing: Randomized (Bezier) ✅
```

## Performance

**Timing Breakdown**:
```
1. Click battle list         [0ms]
2. Release button            [15-50ms] Variable press duration
3. Wait                      [40-120ms] Random delay
4. Move to game world        [50-150ms] Bezier curve
Total: ~105-320ms per click
```

**Still safe**: Well under 400ms targeting timeout ✅

## Updated Files

1. **mouse-controller.cc** - C++ return position parameter
2. **inputOrchestrator.js** - Parameter handling
3. **targetingLogic.js** - `getRandomGameWorldPosition()` function
4. **actions.js** (2 locations) - Both targeting click functions

## Benefits

1. ✅ **No hover interference** - Cursor leaves battle list
2. ✅ **Maximum randomization** - 630K+ possible positions
3. ✅ **Extended area** - Can land outside game world edges
4. ✅ **Looks natural** - Cursor focuses on game area
5. ✅ **Fast execution** - ~150ms average
6. ✅ **Bezier movement** - Natural curved paths
7. ✅ **Pattern proof** - No detectable sequence

## Fallback Behavior

If `gameWorld` region not detected:
- Uses default post-click behavior
- 70%: Small drift (±2px) from click position
- 30%: Move to safe zone (1300-1500, 20-50)

Still randomized, just not game-world-specific.

## Configuration

Current settings (hardcoded):
- **Horizontal margin**: 125px on each side (fixed)
- **Vertical range**: Full game world height
- **Return duration**: 150ms budget

**Why these values**:
- 125px margin: Allows cursor to land slightly outside game world edges
- Full height: Maximum randomization and unpredictability
- 150ms: Fast enough, looks natural

Can be adjusted if game UI layout requires it.

## Testing

Add logging to verify randomization:
```javascript
const returnPos = getRandomGameWorldPosition(sabStateManager);
console.log('Return position:', returnPos);
```

Expected output:
```
Return position: { x: 543, y: 412 }
Return position: { x: -45, y: 187 }  // Left margin!
Return position: { x: 878, y: 556 }
Return position: { x: 912, y: 98 }   // Right margin!
```

All different X and Y, some outside game world edges! ✅

## Detection Resistance Summary

**Before**:
- ❌ Cursor stayed on battle list
- ❌ Triggered hover effects
- ❌ Predictable behavior

**After**:
- ✅ Cursor in/around game world area
- ✅ No UI hover triggers  
- ✅ 630K+ random positions
- ✅ Can land outside game world edges
- ✅ Full vertical randomization
- ✅ No detectable pattern

**Result**: Maximum undetectability for battle list targeting! 🎯

---

**Status**: ✅ IMPLEMENTED
**Date**: 2025-10-02
**Detection Risk**: Very Low
**UI Interference**: None
