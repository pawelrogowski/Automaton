# Rope Waypoint Optimization

## Change Summary

Optimized the rope waypoint action to execute as fast as possible by removing unnecessary delays.

## What Changed

### Before
```javascript
// Used 500ms delay for both rope and shovel
if (useType === 'shovel' || useType === 'rope') {
  await delay(config.animationArrivalTimeoutMs); // 500ms delay
}
```

**Rope execution flow (BEFORE):**
1. Wait 500ms (animation arrival timeout)
2. Press hotkey 'b'
3. Wait 50ms
4. Click map coordinates
5. Check Z-level change every 5ms (timeout after 250ms)

**Total time:** ~550-800ms

---

### After
```javascript
// Only use animation delay for shovel
if (useType === 'shovel') {
  await delay(config.animationArrivalTimeoutMs); // 500ms delay
}
```

**Rope execution flow (AFTER):**
1. Press hotkey 'b' immediately
2. Wait 50ms
3. Click map coordinates
4. Check Z-level change every 5ms (timeout after 250ms)

**Total time:** ~50-300ms

---

## Performance Improvement

- **Minimum execution time:** 550ms → **50ms** (91% faster)
- **Maximum execution time:** 800ms → **300ms** (62.5% faster)
- **Removed unnecessary delay:** 500ms animation wait eliminated

---

## Why This Works

The 500ms `animationArrivalTimeoutMs` delay was originally designed to let the character "settle" after arriving at a position before performing an action. However, for rope:

1. **Rope usage is instant** - pressing hotkey + clicking map is immediate
2. **No animation to wait for** - the rope action itself triggers the floor change
3. **Z-level detection is reliable** - `awaitZLevelChange()` polls every 5ms and will catch the change as soon as it happens
4. **Network latency is handled** - the 250ms timeout is sufficient for server response

The delay is still necessary for **shovel** because:
- Player needs to physically move onto the tile
- Walking animation needs to complete
- Server needs to register the new position

---

## Code Location

**File:** `electron/workers/cavebot/actionHandlers.js`  
**Function:** `handleToolAction()` (line ~226)  
**Change:** Modified conditional from `if (useType === 'shovel' || useType === 'rope')` to `if (useType === 'shovel')`

---

## Testing Recommendations

1. Test rope usage on various floor transitions (up/down)
2. Verify Z-level changes are detected reliably
3. Monitor for any "rope action failed" warnings in console
4. Test in both low and high latency conditions

---

## Related Configurations

All timing constants remain in `electron/workers/cavebot/config.js`:

```javascript
export const config = {
  animationArrivalTimeoutMs: 500,          // Now only used for shovel
  defaultAwaitStateChangeTimeoutMs: 250,   // Used for rope Z-level check
  stateChangePollIntervalMs: 5,            // Z-level check frequency
  // ...
};
```

---

## Date
2025-10-12
