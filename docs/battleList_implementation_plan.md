# BattleList Entry System Implementation Plan

## Overview

This document provides the exact implementation for the battleList entry system based on precise measurements.

## Updated Region Structure

Replace the current `battleList.children.entries` with:

```javascript
entriesRegion: {
  type: 'boundingBox',
  start: {
    direction: 'horizontal',
    offset: { x: 2, y: 13 },
    sequence: [
      // This should be the actual color sequence for the top-left of entry area
      [113, 75, 43],
      [135, 86, 41],
      [159, 136, 40],
      [65, 65, 65],
    ],
  },
  end: {
    direction: 'horizontal',
    offset: { x: -17, y: -5 },
    sequence: [
      // This should be the actual color sequence for the bottom-right of entry area
      [159, 159, 159],
      [160, 160, 160],
      [104, 104, 104],
      [10, 10, 10],
    ],
  },
  maxRight: 156, // Width of entry area
  maxDown: 9999, // Dynamic height based on battleList size
  children: {
    // Individual entry slots - calculated dynamically based on available space
    entry0: { type: 'fixed', x: 0, y: 0, width: 156, height: 20 },
    entry1: { type: 'fixed', x: 0, y: 22, width: 156, height: 20 },
    entry2: { type: 'fixed', x: 0, y: 44, width: 156, height: 20 },
    entry3: { type: 'fixed', x: 0, y: 66, width: 156, height: 20 },
    entry4: { type: 'fixed', x: 0, y: 88, width: 156, height: 20 },
    entry5: { type: 'fixed', x: 0, y: 110, width: 156, height: 20 },
    entry6: { type: 'fixed', x: 0, y: 132, width: 156, height: 20 },
    entry7: { type: 'fixed', x: 0, y: 154, width: 156, height: 20 },
    entry8: { type: 'fixed', x: 0, y: 176, width: 156, height: 20 },
    entry9: { type: 'fixed', x: 0, y: 198, width: 156, height: 20 },
    entry10: { type: 'fixed', x: 0, y: 220, width: 156, height: 20 },
    entry11: { type: 'fixed', x: 0, y: 242, width: 156, height: 20 },
    entry12: { type: 'fixed', x: 0, y: 264, width: 156, height: 20 },
    entry13: { type: 'fixed', x: 0, y: 286, width: 156, height: 20 },
    entry14: { type: 'fixed', x: 0, y: 308, width: 156, height: 20 },
    entry15: { type: 'fixed', x: 0, y: 330, width: 156, height: 20 },
    entry16: { type: 'fixed', x: 0, y: 352, width: 156, height: 20 },
    entry17: { type: 'fixed', x: 0, y: 374, width: 156, height: 20 },
    entry18: { type: 'fixed', x: 0, y: 396, width: 156, height: 20 },
    entry19: { type: 'fixed', x: 0, y: 418, width: 156, height: 20 },
  }
}
```

## Color Sequences for Battle Entry Detection

Each battle entry has these visual elements:

1. **Monster icon** (32x32px on left)
2. **Monster name** (text)
3. **Health bar** (variable width based on health)
4. **Target borders** (red outer, black inner)

### Entry Detection Sequence

For detecting individual entries, use the health bar or name text area:

```javascript
// Health bar detection for battle entries
battleEntryHealthBar: {
  type: 'single',
  direction: 'horizontal',
  offset: { x: 35, y: 8 }, // Position relative to entry top-left
  sequence: [
    [241, 97, 97], // Red health (full)
    [219, 91, 91],
    [103, 55, 55],
    'any',
    'any',
    [120, 61, 64], // Dark border
  ],
  width: 94,
  height: 14,
}
```

## Implementation Steps

1. **Replace the current entries boundingBox** with the entriesRegion structure
2. **Add the individual entry slots** as fixed children
3. **Update battleListSequences.js** with proper color sequences for entry detection
4. **Test with actual game screenshots** to verify positioning

## Dynamic Entry Count

The system will automatically determine how many entries are visible based on:

- The calculated height of entriesRegion
- The fixed 22px height per entry (20px entry + 2px spacing)

This gives you: `maxEntries = Math.floor(entriesRegion.height / 22)`

## Usage in Screen Monitor

The regionMonitor will provide:

- `regions.battleList.children.entriesRegion` - the scrollable entry area
- `regions.battleList.children.entriesRegion.children.entry0` through `entry19` - individual entry positions
