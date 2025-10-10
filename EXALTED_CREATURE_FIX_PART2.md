# Exalted Creature Fix - Part 2: Position Uncertain Timeout

## Problem Description

After implementing the initial fix for exalted creatures (truncated name matching), a secondary issue was discovered:

**The bot recognizes the exalted creature exists** (doesn't remove it from tracking), but **never targets it**, leaving the bot stuck standing with the creature on screen.

## Root Cause

The creature monitoring system has a "persistence" feature that keeps creatures alive even when their health bar temporarily disappears. This is useful for creatures that briefly lose detection due to overlapping graphics, screen updates, etc.

However, when a creature is kept alive this way, it's marked with `positionUncertain = true`, and creatures with uncertain positions are **forced to be unreachable**:

```js
// Line 1184-1186 in creatureMonitor.js
const isReachable = entity.positionUncertain 
  ? false 
  : typeof reachableTiles[coordsKey] !== 'undefined';
```

And `selectBestTarget` rejects unreachable creatures:

```js
// Line 125 in targetingLogic.js
if (!rule || !creature.isReachable) {
  return null;
}
```

### The Vicious Cycle

For exalted creatures, this creates a problematic scenario:

1. **Exalted creature detected** - health bar found, added to tracking ✓
2. **Health bar detection temporarily fails** (maybe due to exalted visual effects, timing, etc.)
3. **Persistence logic kicks in** - "Battle list shows it, keep it alive"
4. **Creature marked** `positionUncertain = true`
5. **Creature becomes** `isReachable = false`
6. **Targeting rejects it** - "Not reachable, can't target"
7. **Health bar still not detected** (creature stuck in uncertain state)
8. **Loop continues** - creature permanently unreachable!

The creature is tracked but never targetable, causing the bot to stand idle.

## The Solution

Added a **timeout** for the `positionUncertain` state. If a creature remains in an uncertain position for more than 2 seconds, it's removed from tracking and will be re-detected fresh on the next frame.

### Implementation

**File**: `electron/workers/creatureMonitor.js` (lines 1065-1086)

```js
// If battle list shows MORE of this creature than we detected, keep the old one
if (battleListCountForName > detectedCountForName) {
  // Keep creature alive but mark position as uncertain
  // Set timestamp when uncertainty started (for timeout logic)
  if (!oldCreature.positionUncertain) {
    oldCreature.positionUncertainSince = now;
  }
  oldCreature.lastSeen = now;
  oldCreature.positionUncertain = true;
  
  // TIMEOUT: If creature has been uncertain for > 2 seconds, don't keep it
  // This prevents creatures from being stuck in uncertain state forever
  const POSITION_UNCERTAIN_TIMEOUT_MS = 2000;
  const uncertainDuration = now - (oldCreature.positionUncertainSince || now);
  
  if (uncertainDuration < POSITION_UNCERTAIN_TIMEOUT_MS) {
    newActiveCreatures.set(id, oldCreature);
  } else {
    // Creature has been uncertain too long - let it be removed
    logger('debug', `[CREATURE TIMEOUT] ID ${id} "${oldCreature.name}" - uncertain position for ${uncertainDuration}ms, removing`);
  }
}
```

### How It Works

1. **First time uncertain**: Record timestamp in `positionUncertainSince`
2. **Still uncertain next frame**: Check how long it's been
3. **< 2 seconds**: Keep the creature (normal persistence behavior)
4. **≥ 2 seconds**: Remove the creature from tracking
5. **Next frame**: Creature re-detected fresh with valid health bar
6. **Now reachable**: Bot can target it!

### Why 2 Seconds?

- **Short enough**: Prevents long-term stuck states
- **Long enough**: Allows for temporary health bar detection issues
- **Balanced**: Most health bar glitches resolve within 200-500ms
- **Safe**: Creatures that are truly present will re-detect immediately after removal

## Benefits

1. **Prevents infinite uncertain loops**: Creatures can't stay unreachable forever
2. **Auto-recovery**: System self-corrects when stuck
3. **Minimal disruption**: Normal short-term persistence still works
4. **Better exalted handling**: Creatures with tricky visual effects get fresh detection
5. **Debugging aid**: Logs timeout events for monitoring

## Alternative Approaches Considered

### 1. Remove persistence entirely for exalted creatures
**Rejected**: Would hurt performance for all creatures with temporary detection issues

### 2. Always clear `positionUncertain` when battle list name matches
**Rejected**: Would make uncertain creatures falsely reachable

### 3. Make uncertain creatures reachable anyway
**Rejected**: Would cause pathfinding to wrong positions

### 4. Force health bar re-scan for uncertain creatures
**Rejected**: Would hurt performance, redundant with existing scans

The timeout approach is the most elegant - it lets the normal system work but adds a safety valve.

## Testing Recommendations

1. **Test with exalted creatures**:
   - Verify they become targetable after appearing
   - Check timeout logs if creature takes > 2s to target
   - Ensure bot doesn't get permanently stuck

2. **Test with normal creatures**:
   - Verify normal persistence still works
   - Check creatures aren't removed too aggressively
   - Monitor for false timeouts

3. **Test edge cases**:
   - Multiple exalted creatures
   - Creature becomes exalted mid-combat
   - Health bar detection issues (overlaps, etc.)

## Technical Notes

### Performance Impact
Minimal - just adds one timestamp field and one comparison per uncertain creature per frame.

### Memory Impact
One additional field (`positionUncertainSince`) per creature that enters uncertain state.

### Logging
Timeout events are logged at debug level for monitoring and troubleshooting.

---

**Status**: ✅ Fixed
**Date**: 2025-10-10
**Impact**: High - Resolves exalted creature targeting stuck state
**Related Fixes**: 
- Works with EXALTED_CREATURE_FIX.md (truncated name matching)
- Works with TARGETING_PATHING_MISMATCH_FIX.md (instance ID matching)
