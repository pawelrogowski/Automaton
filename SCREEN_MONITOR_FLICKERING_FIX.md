# Screen Monitor Flickering Fix

## Problem Description

The mana value (and potentially health value) was flickering between `undefined`/`null` and the correct value in the store. This manifested as unstable UI readings and potentially incorrect bot behavior based on resource levels.

## Root Cause

The issue was in the **checksum optimization logic** for health and mana bar scanning in `electron/workers/screenMonitor.js`.

### The Flawed Logic (Lines 342-366)

The original condition for skipping calculation was:
```javascript
const same = lastBarChecksums.manaBar !== null && ck === lastBarChecksums.manaBar;
const withinFallback = now - lastScanTs.manaBar < FALLBACK.manaBar;
if (!(same && withinFallback && mbDirty && hasScannedInitially)) {
  // Calculate mana
}
```

**The problem:** This logic required `mbDirty` (dirty rectangle intersecting mana bar) to be `true` for skipping the calculation.

### Why This Caused Flickering

The boolean logic worked like this:

**When NO dirty rect intersects mana bar** (`mbDirty = false`):
- Outer condition: `mbDirty || now - lastScanTs.manaBar > FALLBACK.manaBar` 
- If not past fallback time: **Entire block is SKIPPED**
- `lastCalculatedState.mppc` is **NOT updated**
- Old value (possibly `null`) is sent to store

**When dirty rect intersects** (`mbDirty = true`):
- Enters the block
- Inner condition: `!(same && withinFallback && true && hasScannedInitially)`
- If checksum unchanged: **Calculation is SKIPPED**
- `lastCalculatedState.mppc` is **NOT updated**
- Old value persists

**When checksum changes** OR **past fallback time**:
- Calculation runs
- `lastCalculatedState.mppc` is **UPDATED** with correct value
- New value sent to store

### Result: Alternating Values

The screen monitor runs every 50ms. Depending on:
1. Whether dirty rects intersect the mana bar
2. Whether the checksum has changed
3. Whether fallback time has elapsed

The mana value would alternate between:
- **Correct value** (when calculation runs)
- **Stale/null value** (when calculation is skipped but value still sent)

## Solution Implemented

Simplified the skip logic to only depend on:
1. **Checksum unchanged** - The visual content hasn't changed
2. **Within fallback period** - Haven't exceeded the maximum time between scans
3. **Has scanned initially** - We have at least one baseline scan

```javascript
const checksumUnchanged = lastBarChecksums.manaBar !== null && ck === lastBarChecksums.manaBar;
const withinFallback = now - lastScanTs.manaBar < FALLBACK.manaBar;
// Skip calculation only if checksum is unchanged AND we're within fallback period AND we've scanned before
const shouldSkip = checksumUnchanged && withinFallback && hasScannedInitially;
if (!shouldSkip) {
  lastCalculatedState.mppc = calculateManaBar(bufferToUse, metadata, regions.manaBar);
  lastScanTs.manaBar = now;
  lastBarChecksums.manaBar = ck;
}
```

### Key Changes

1. **Removed `mbDirty` from skip condition** - Dirty rect status shouldn't affect whether we skip; it only affects whether we enter the scanning block at all
2. **Clearer variable naming** - `checksumUnchanged` and `shouldSkip` make the logic explicit
3. **Always update when needed** - If we enter the block and checksum changed OR we're past fallback, we calculate

## How It Works Now

### Scenario 1: Mana bar unchanged, within fallback time
- Checksum computed
- Checksum matches previous
- Within 300ms of last scan
- **Skip calculation** (optimization working correctly)
- Previous valid value in `lastCalculatedState.mppc` is reused

### Scenario 2: Mana bar changed (user drank potion, cast spell, etc.)
- Checksum computed
- Checksum differs from previous
- **Calculate new value**
- `lastCalculatedState.mppc` updated
- Correct new value sent to store

### Scenario 3: Past fallback time
- More than 300ms since last scan
- **Force calculation** regardless of checksum
- Ensures we never go too long without update
- `lastCalculatedState.mppc` refreshed

### Scenario 4: Initial scan
- `hasScannedInitially = false`
- **Always calculate** on first scan
- Establishes baseline value
- All subsequent scans can use optimization

## Benefits

1. **No more flickering** - Value is always either calculated fresh or reused from valid previous calculation
2. **Maintains optimization** - Still skips expensive calculations when visual content hasn't changed
3. **Proper fallback** - Still enforces maximum time between scans
4. **Clearer logic** - Easier to understand and maintain

## Performance Impact

- **No change** - Still using checksum optimization
- **Still fast** - Only calculates when needed
- **More reliable** - Doesn't send stale/null values

## Testing

To verify the fix:

1. Watch the mana bar in the UI
2. Observe it should show a stable value, not flickering
3. Cast spells or drink potions to change mana
4. Value should update smoothly without undefined/null flashes
5. Check console logs (if debug enabled) for proper calculation flow

## Files Modified

1. `electron/workers/screenMonitor.js` - Fixed health bar optimization logic (lines 342-354)
2. `electron/workers/screenMonitor.js` - Fixed mana bar optimization logic (lines 355-367)
3. `SCREEN_MONITOR_FLICKERING_FIX.md` - This documentation

## Additional Notes

The same fix was applied to **both** health bar and mana bar scanning, as they used identical flawed logic. Both should now be stable.

The checksum optimization is still valuable because:
- Avoids expensive pixel-by-pixel analysis when visuals haven't changed
- Reduces CPU load during idle periods
- Maintains 50ms scan rate without performance issues

The fallback timers ensure that even if something goes wrong with checksums (collision, etc.), we'll still get fresh data at least every 300ms for resource bars.
