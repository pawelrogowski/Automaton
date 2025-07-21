# Complete BattleList Entry System Implementation

## Precise Entry Structure

Based on exact measurements provided:

### Entry Layout (20x20px per entry)

- **Entry size**: 20×20px
- **Icon area**: 20×20px with optional borders
- **Border detection**: Check pixels at specific positions

### Border Detection System

- **Red target border**: [255, 0, 0] at position (0,0) - indicates currently targeted monster (only 1 at a time)
- **Black attack border**: [0, 0, 0] at position (1,1) - indicates monster is targeting player (isAttacking)

### Text Area (Monster Name)

- **Position**: 22px right, 2px down from entry (0,0)
- **Size**: 131px width × 12px height
- **Purpose**: OCR for monster name detection

### Health Bar

- **Position**: 22px right, 15px down from entry (0,0)
- **Size**: 132px width × 5px height (including 1px black border)
- **Validation**: Check top-left pixel (22,15) - if not black, entry is invalid
- **Health area**: 130×3px inside black border for health percentage calculation

## Updated Region Structure

Replace the current `battleList.children.entries` with this complete structure:

```javascript
entriesRegion: {
  type: 'boundingBox',
  start: {
    direction: 'horizontal',
    offset: { x: 2, y: 13 },
    sequence: [
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
      [159, 159, 159],
      [160, 160, 160],
      [104, 104, 104],
      [10, 10, 10],
    ],
  },
  maxRight: 156,
  maxDown: 9999,
  children: {
    // Individual battle entries with all subregions
    entry0: {
      type: 'fixed', x: 0, y: 0, width: 20, height: 20,
      children: {
        // Border detection regions
        targetBorder: {
          type: 'single',
          direction: 'horizontal',
          offset: { x: 0, y: 0 },
          sequence: [[255, 0, 0]],
          width: 1,
          height: 1,
        },
        attackBorder: {
          type: 'single',
          direction: 'horizontal',
          offset: { x: 1, y: 1 },
          sequence: [[0, 0, 0]],
          width: 1,
          height: 1,
        },
        // Monster name region
        nameText: {
          type: 'fixed',
          x: 22, y: 2, width: 131, height: 12,
          ocrColors: [
            [240, 240, 240], // White text
            [192, 192, 192], // Gray text
            [255, 255, 255], // Bright white
          ],
        },
        // Health bar region
        healthBar: {
          type: 'fixed',
          x: 22, y: 15, width: 132, height: 5,
          children: {
            // Validation pixel (top-left of health bar)
            validationPixel: {
              type: 'single',
              direction: 'horizontal',
              offset: { x: 0, y: 0 },
              sequence: [[0, 0, 0]], // Black border validation
              width: 1,
              height: 1,
            },
            // Actual health bar area (inside black border)
            healthArea: {
              type: 'fixed',
              x: 1, y: 1, width: 130, height: 3,
              // Health colors will be detected dynamically
            },
          },
        },
      },
    },
    entry1: {
      type: 'fixed', x: 0, y: 22, width: 20, height: 20,
      children: { /* Same structure as entry0 */ }
    },
    entry2: {
      type: 'fixed', x: 0, y: 44, width: 20, height: 20,
      children: { /* Same structure as entry0 */ }
    },
    // Continue pattern for entries 3-19...
    entry3: { type: 'fixed', x: 0, y: 66, width: 20, height: 20, children: { /* ... */ } },
    entry4: { type: 'fixed', x: 0, y: 88, width: 20, height: 20, children: { /* ... */ } },
    entry5: { type: 'fixed', x: 0, y: 110, width: 20, height: 20, children: { /* ... */ } },
    entry6: { type: 'fixed', x: 0, y: 132, width: 20, height: 20, children: { /* ... */ } },
    entry7: { type: 'fixed', x: 0, y: 154, width: 20, height: 20, children: { /* ... */ } },
    entry8: { type: 'fixed', x: 0, y: 176, width: 20, height: 20, children: { /* ... */ } },
    entry9: { type: 'fixed', x: 0, y: 198, width: 20, height: 20, children: { /* ... */ } },
    entry10: { type: 'fixed', x: 0, y: 220, width: 20, height: 20, children: { /* ... */ } },
    entry11: { type: 'fixed', x: 0, y: 242, width: 20, height: 20, children: { /* ... */ } },
    entry12: { type: 'fixed', x: 0, y: 264, width: 20, height: 20, children: { /* ... */ } },
    entry13: { type: 'fixed', x: 0, y: 286, width: 20, height: 20, children: { /* ... */ } },
    entry14: { type: 'fixed', x: 0, y: 308, width: 20, height: 20, children: { /* ... */ } },
    entry15: { type: 'fixed', x: 0, y: 330, width: 20, height: 20, children: { /* ... */ } },
    entry16: { type: 'fixed', x: 0, y: 352, width: 20, height: 20, children: { /* ... */ } },
    entry17: { type: 'fixed', x: 0, y: 374, width: 20, height: 20, children: { /* ... */ } },
    entry18: { type: 'fixed', x: 0, y: 396, width: 20, height: 20, children: { /* ... */ } },
    entry19: { type: 'fixed', x: 0, y: 418, width: 20, height: 20, children: { /* ... */ } },
  }
}
```

## Color Sequences for Detection

### Border Detection

```javascript
// In battleListSequences.js
const battleListSequences = {
  targetBorder: {
    type: 'single',
    direction: 'horizontal',
    offset: { x: 0, y: 0 },
    sequence: [[255, 0, 0]], // Red target indicator
    width: 1,
    height: 1,
  },
  attackBorder: {
    type: 'single',
    direction: 'horizontal',
    offset: { x: 1, y: 1 },
    sequence: [[0, 0, 0]], // Black attack indicator
    width: 1,
    height: 1,
  },
  healthBarValidation: {
    type: 'single',
    direction: 'horizontal',
    offset: { x: 0, y: 0 },
    sequence: [[0, 0, 0]], // Black border validation
    width: 1,
    height: 1,
  },
};
```

## Usage in Screen Monitor

The regionMonitor will provide:

```javascript
// Access individual battle entries
regions.battleList.children.entriesRegion.children.entry0;
regions.battleList.children.entriesRegion.children.entry1;
// ... up to entry19

// For each entry, access specific components:
entry.targetBorder; // [255,0,0] detection
entry.attackBorder; // [0,0,0] detection
entry.nameText; // OCR region for monster name
entry.healthBar.validationPixel; // Validation check
entry.healthBar.healthArea; // 130×3px health calculation area
```

## Implementation Steps

1. **Replace** the current `entries` boundingBox in regionDefinitions.js
2. **Add** the complete entry structure with all subregions
3. **Update** battleListSequences.js with border detection sequences
4. **Test** with actual game screenshots to verify positioning
5. **Implement** health percentage calculation logic using the 130×3px healthArea

This structure provides complete access to all battle entry components with precise positioning based on your exact measurements.
