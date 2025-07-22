# Coordinate Debug Analysis

## Problem: entries x:3142 when battleList is at x:1570

## Tracing the Calculation

Let's trace through the regionMonitor coordinate calculation:

### Given:

- battleList found at x:1570
- entries bounding box has:
  - start: offset {x:2, y:13}
  - end: offset {x:-17, y:-5}
  - maxRight: 165
  - maxDown: 9999

### Step-by-step calculation:

1. **battleList calculation**:
   - start sequence found at some position
   - end sequence found at some position
   - battleList.x = 1570 (calculated from start/end positions)

2. **entries bounding box calculation**:
   - startResult = position where entries.start sequence is found
   - endResult = position where entries.end sequence is found
   - entries.x = startResult.x (absolute screen position)
   - entries.width = endResult.x - startResult.x + 1

## **Root Cause Identified**

The issue is that **the entries bounding box is being calculated as an independent region** rather than being constrained within the parent battleList.

Looking at lines 124-146 in regionMonitor.js:

```javascript
const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

const endSearchArea = {
  x: baseOffset.x + startResult.x,
  y: baseOffset.y + startResult.y,
  width: Math.min(maxW, metadata.width - (baseOffset.x + startResult.x)),
  height: Math.min(maxH, metadata.height - (baseOffset.y + startResult.y)),
};
```

## **The Real Problem**

The `baseOffset` here is **the absolute screen position of the parent battleList**, but the `maxRight: 165` is being applied to this absolute position, creating:

- searchArea.x = 1570 + 2 = 1572
- searchArea.width = 165
- searchArea extends to 1572 + 165 = 1737

However, the x:3142 suggests the sequence is being found much further right, indicating:

1. **The color sequences are too generic** and matching unintended areas
2. **The search bounds are not properly constrained** to the battleList dimensions
3. **The offset calculation is cumulative** across nested levels

## **Specific Issue**

The problem is that **maxRight and maxDown in nested bounding boxes are being interpreted as absolute screen bounds**, not relative to the parent region.

## **Solution**

The regionMonitor needs to constrain the search area to the actual parent bounding box dimensions, not use absolute screen coordinates.

**The fix requires modifying the search area calculation in regionMonitor.js** to use the parent region's actual dimensions as bounds, rather than applying maxRight/maxDown as absolute screen constraints.
