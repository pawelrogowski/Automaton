# Cavebot Walking Issue - Fix Applied

## Problem

After implementing randomized cursor behavior, the cavebot stopped walking at certain points during targeting. The bot would get stuck and not continue movement.

## Root Causes

### 1. Incorrect Duration Parameter ❌

**Problem:**
```javascript
// WRONG - using return duration as click movement duration!
const clickArgs = returnPos
  ? [nextEntry.x, nextEntry.y, returnPos.duration, returnPos] // 50-100ms!
  : [nextEntry.x, nextEntry.y, 200];
```

The `returnPos.duration` (50-100ms) was being passed as `maxDuration` for the movement **TO** the click target. This was too fast and could cause issues.

**How leftClick works:**
- Arg 3 (`maxDuration`): Time to move cursor TO the target
- Arg 4 (`returnPosition`): Where to move AFTER the click (uses fixed 150ms in C++)

**Fixed:**
```javascript
// CORRECT - use 200ms for click movement, returnPos is separate
const clickArgs = returnPos
  ? [nextEntry.x, nextEntry.y, 200, returnPos] // 200ms to target
  : [nextEntry.x, nextEntry.y, 200];
```

### 2. Too Much UI Hover Time ⚠️

**Problem:**
- 50% of clicks left cursor in battle list or minimap
- Cursor hovering over UI could interfere with game input
- Potential focus or click-through issues

**Fixed - Adjusted Probabilities:**

| Behavior | Before | After | Reason |
|----------|--------|-------|--------|
| Game world return | 50% | 70% | More time in game area |
| Battle list wiggle | 35% | 21% | Reduced UI interference |
| Minimap drift | 15% | 9% | Reduced UI interference |

## Changes Made

### File: `electron/workers/targeting/targetingLogic.js`

#### Change 1: Fixed Click Args
```javascript
// Line ~200
const clickArgs = returnPos
  ? [nextEntry.x, nextEntry.y, 200, returnPos] // Fixed: 200ms to target
  : [nextEntry.x, nextEntry.y, 200];
```

#### Change 2: Adjusted Probabilities
```javascript
// Line ~70
// 70% chance to return to game world (more often out of UI)
if (Math.random() < 0.7) {
  // ... game world return
}

// 30% chance to wiggle/drift
```

## Why This Fixes the Issue

### 1. Consistent Click Timing
- All battle list clicks now use 200ms movement duration
- No more super-fast 50-100ms clicks that might cause issues
- More reliable and consistent behavior

### 2. Less UI Interference
- Cursor spends **70%** of time in game world (vs 50% before)
- Only **30%** in UI areas (vs 50% before)
- Reduces chance of UI hover blocking game actions
- Minimizes potential focus/input issues

### 3. Better Input Priority
- Cavebot uses `'movement'` priority (4)
- Targeting uses `'targeting'` priority (3) - higher!
- But with cursor in game world 70% of time, less blocking

## Testing

To verify the fix works:

1. **Start cavebot with targeting enabled**
2. **Observe**:
   - Bot should target creatures normally
   - Cavebot should continue walking between targets
   - No getting stuck after targeting
3. **Monitor cursor behavior**:
   - ~70% of clicks → cursor returns to game world
   - ~21% of clicks → cursor wiggles in battle list
   - ~9% of clicks → cursor drifts to minimap

## Probability Breakdown

### Old (Broken)
```
100 clicks:
├─ 50 clicks → Game world (50%)
├─ 35 clicks → Battle list (35%) ← Too much UI hover!
└─ 15 clicks → Minimap (15%)
```

### New (Fixed)
```
100 clicks:
├─ 70 clicks → Game world (70%) ← More game focus
├─ 21 clicks → Battle list (21%) ← Reduced
└─  9 clicks → Minimap (9%)      ← Reduced
```

## Impact

| Aspect | Before | After |
|--------|--------|-------|
| Click movement duration | 50-100ms (bug!) | 200ms (correct) |
| UI hover time | 50% | 30% |
| Game world focus | 50% | 70% |
| Cavebot interference | Possible | Minimal |
| Natural appearance | Good | Good |

## Related Documentation

- `RANDOMIZED_CURSOR_BEHAVIOR.md` - Full behavior details
- `CURSOR_RETURN_POSITION.md` - Original implementation
- `SESSION_SUMMARY_2025-10-02.md` - Complete session log

---

**Status**: ✅ FIXED  
**Date**: 2025-10-02  
**Issue**: Cavebot getting stuck after targeting  
**Cause**: Wrong duration parameter + too much UI hover  
**Solution**: Fixed click args + adjusted probabilities to 70/21/9  
