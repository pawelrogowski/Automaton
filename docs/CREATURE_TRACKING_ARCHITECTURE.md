# Creature Tracking Architecture - Battle List as Source of Truth

## Current Issues

The existing creature detection system has several limitations:

1. **Health bar driven** - Treats health bars as primary source, then matches to battle list
2. **Flickering** - Creatures disappear when health bars temporarily undetected
3. **Ambiguous matching** - When multiple creatures have same name, matching is unreliable
4. **Ignores battle list truth** - Battle list tells us exactly what creatures exist, but we don't fully leverage this

## Proposed Architecture

### Core Principle: Battle List is Source of Truth

The battle list is the definitive source for:
- **What creatures exist** in the game world
- **How many of each type** are present
- **When creatures die** (count decreases)

Health bars provide:
- **Spatial coordinates** for creatures
- **Visual confirmation** of creature position
- **HP status** (percentage, obstructed, etc.)

### New Approach

```
┌─────────────────┐
│  Battle List    │ ◄─── SOURCE OF TRUTH (what exists)
│  - Rat x2       │
│  - Troll x1     │
│  - Dragon x1    │
└────────┬────────┘
         │
         │ Match by name + proximity
         ▼
┌─────────────────┐
│  Health Bars    │ ◄─── COORDINATE PROVIDER (where they are)
│  - Bar @ (X,Y)  │
│  - Bar @ (X,Y)  │
│  - Bar @ (X,Y)  │
└─────────────────┘
```

## Implementation Plan

### Phase 1: Battle List Count Tracking

**Goal:** Prevent flickering by trusting battle list count

```javascript
// Track battle list state
const battleListState = {
  entries: Map<string, number>,  // name -> count
  lastChange: timestamp,
  totalCount: number
};

// Rule: If battle list count unchanged, creatures still exist
if (battleListState.totalCount === previousTotalCount) {
  // Keep all tracked creatures alive
  // Just update their positions if health bars found
  // DON'T delete creatures just because health bar missing
}
```

**Benefits:**
- Eliminates flickering when health bars temporarily lost
- Creatures persist between scans
- More stable targeting

### Phase 2: Smart Name Matching

**Goal:** Handle truncated names and multiple creatures intelligently

```javascript
// Build name matcher
const nameMatches = (battleName, ocrName) => {
  // Exact match
  if (battleName === ocrName) return true;
  
  // Truncated match (e.g., "troll trained sala..." matches "troll trained salamander")
  if (battleName.endsWith('...')) {
    const truncated = battleName.slice(0, -3);
    return ocrName.startsWith(truncated);
  }
  
  // Fuzzy match for OCR errors
  return fuzzyMatch(battleName, ocrName) > 0.8;
};
```

**Benefits:**
- Handles battle list truncation automatically
- Recovers from OCR errors
- More reliable creature identification

### Phase 3: Position-Based Tracking

**Goal:** Track multiple creatures with same name reliably

```javascript
// Track creatures by battle list name + position slot
const creatureTracking = {
  "Rat_0": { name: "Rat", position: {x, y, z}, healthBarId: id1 },
  "Rat_1": { name: "Rat", position: {x, y, z}, healthBarId: id2 },
  "Troll_0": { name: "Troll", position: {x, y, z}, healthBarId: id3 }
};

// Matching algorithm
function matchHealthBarsToCreatures(healthBars, creatures) {
  // For each battle list entry
  for (const [slotId, creature] of creatures) {
    // Find closest unmatched health bar
    const candidate = findClosestHealthBar(
      healthBars,
      creature.position,
      creature.name
    );
    
    if (candidate) {
      // Update creature position
      creature.position = candidate.position;
      creature.lastSeen = now;
    } else if (battleListCountUnchanged) {
      // Creature still exists (per battle list) but health bar lost
      // Keep creature alive, mark as "position uncertain"
      creature.positionUncertain = true;
    }
  }
}
```

**Benefits:**
- Reliable tracking of multiple creatures with same name
- Position continuity between frames
- Smart handling of temporary detection loss

### Phase 4: Battle List Driven Lifecycle

**Goal:** Creature lifecycle driven by battle list, not health bars

```javascript
// Creature lifecycle events
function updateCreatures(battleList, healthBars) {
  // BIRTH: New entry in battle list
  for (const entry of battleList) {
    if (!isTracked(entry.name, slot)) {
      createCreature(entry.name, slot);
    }
  }
  
  // UPDATE: Battle list unchanged, update positions from health bars
  if (battleListCountUnchanged) {
    matchHealthBarsToCreatures(healthBars, trackedCreatures);
  }
  
  // DEATH: Battle list count decreased
  const disappeared = findDisappearedCreatures(
    previousBattleList,
    currentBattleList
  );
  for (const creature of disappeared) {
    removeCreature(creature);
    triggerLooting();
  }
}
```

**Benefits:**
- Creatures only die when battle list confirms it
- No false deaths from temporary health bar loss
- Accurate death detection for looting

## Migration Strategy

This can be implemented incrementally:

1. **Phase 1** (Low risk): Add battle list count tracking, prevent premature deletion
2. **Phase 2** (Medium risk): Improve name matching logic
3. **Phase 3** (Higher risk): Add position-based multi-creature tracking
4. **Phase 4** (Full rewrite): Battle list driven lifecycle

Each phase adds value independently while building toward the complete solution.

## Benefits Summary

### Current System
- ❌ Creatures flicker when health bars lost
- ❌ Unreliable with multiple same-name creatures
- ❌ Ignores battle list as truth source
- ❌ False creature deaths

### Improved System
- ✅ Stable creature tracking
- ✅ Handles multiple creatures reliably
- ✅ Battle list as source of truth
- ✅ Accurate death detection
- ✅ Better truncated name handling
- ✅ Position continuity

## Technical Considerations

### Edge Cases to Handle

1. **Z-level changes**: Battle list persists but creatures move between floors
2. **Off-screen creatures**: In battle list but outside game world view
3. **OCR failures**: Health bar detected but name OCR fails
4. **Rapid changes**: Creature dies and new one spawns in same frame
5. **Name collisions**: Two different creature types with similar names

### Performance

- Battle list: ~10-50 entries typical
- Health bars: ~10-20 detected per frame
- Matching algorithm: O(n*m) but n,m are small
- Memory: Minimal (tracking ~50 creatures max)

### Testing Strategy

1. **Unit tests**: Name matching, truncation handling
2. **Integration tests**: Full cycle with mock battle list + health bars
3. **Field testing**: 
   - Single creature scenarios
   - Multiple same-name creatures
   - Rapid spawn/death cycles
   - Z-level transitions

## Current Workarounds

Until full implementation:
- Extended grace periods for stationary creatures (DONE)
- Truncated name matching (DONE)
- "Others" wildcard support (DONE)
- Battle list count tracking for looting (DONE)

These provide significant improvements while the full architecture is developed.
