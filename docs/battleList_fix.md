# BattleList Coordinate Fix

## Problem Analysis

The entries bounding box is calculating absolute screen coordinates instead of relative coordinates to the parent battleList. This causes impossible values like x:3146.

## Root Cause

The nested bounding box is using the same search area as the parent battleList, leading to cumulative offset errors.

## Solution

Instead of using a nested bounding box, we should use a **fixed region approach** that directly calculates the entry area based on the battleList dimensions.

## Recommended Fix

Replace the current entries bounding box with a **fixed region** that represents the entry area:

```javascript
entries: {
  type: 'fixed',
  x: 2,    // 2px from left of battleList
  y: 13,   // 13px from top of battleList
  width: 156,  // Entry area width
  height: 440, // Maximum height for 20 entries (20 * 22px)
  children: {
    entry0: { type: 'fixed', x: 0, y: 0, width: 20, height: 20, ... },
    entry1: { type: 'fixed', x: 0, y: 22, width: 20, height: 20, ... },
    // ... continue for all 20 entries
  }
}
```

## Alternative Approach

If you need dynamic sizing, use a **single bounding box** for the entire battleList and then calculate entry positions programmatically based on the found battleList dimensions.

## Testing

After implementing this fix, the coordinates should be:

- Relative to battleList top-left
- Within reasonable screen bounds
- Consistent with your measurements
