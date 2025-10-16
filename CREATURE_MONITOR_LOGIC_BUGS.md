# CreatureMonitor.js Logic Bugs - Refined Analysis

## Executive Summary
This document identifies **actual logic bugs** in `creatureMonitor.js` based on verified behavior of detection modules. The native detection modules (health bars, OCR, target box) are **100% accurate**. Bugs exist in the **logic that processes this accurate data**.

---

## VERIFIED FACTS (Not Assumptions)

### Detection Accuracy
- ✅ Health bar detection is 100% accurate (native module verified)
- ✅ Battle list OCR is 100% accurate (names always correct)
- ✅ Battle list count = actual targetable creatures (perfect correlation)
- ✅ Target box detection is 100% accurate
- ✅ Battle list target marker detection is 100% accurate
- ✅ Health bars are ALWAYS visible (no fog of war, no UI overlap)
- ✅ Player health bar is stationary in screen space (game world scrolls around it)
- ✅ Nameplates never occluded by terrain

### Game Behavior
- ✅ Battle list order is stable (oldest visible to newest)
- ✅ Battle list truncation uses "..." consistently across versions
- ✅ Battle list shows only targetable creatures
- ✅ Battle list decreasing = creature died or left screen (loot trigger correct)

### Position Calculation
- ✅ Screen-to-game coordinate conversion perfect when stationary
- ✅ Movement handling works correctly (viewport scroll accounted for)
- ✅ Player animation freeze (25ms) prevents reporting coords during scroll
- ✅ Jitter confirmation (75ms) works correctly
- ✅ Creature center calculation is correct

---

## ACTUAL BUGS (Logic Errors)

### BUG #1: Multiple Creatures with Same Name (CRITICAL)
**Location**: Lines 670-718 (STAGE 1 creature tracking)

**Problem**: When multiple creatures have identical names, the closest health bar matching logic doesn't ensure 1-to-1 mapping.

**Scenario**:
```
Battle List: Dragon, Dragon, Dragon (3 total)
Active Creatures Map: 
  - instanceId=10, name="Dragon", pos=(100,100)
  - instanceId=11, name="Dragon", pos=(100,102)  
  - instanceId=12, name="Dragon", pos=(105,105)

Dragon at (105,105) dies.
Health bars detected: (100,100), (100,102)

Current logic:
  - instanceId=10 matches health bar at (100,100) ✓
  - instanceId=11 matches health bar at (100,102) ✓
  - instanceId=12 has no health bar but "Dragon" still in battle list (count=3 detected, count=3 expected)
  - instanceId=12 kept as "positionUncertain" for 2s ✗

Better logic should:
  - Count how many instances of "Dragon" we have
  - Count how many health bars we matched
  - If matched < battle list count, keep unmatched as positionUncertain
  - If matched = battle list count, DELETE unmatched (they died)
```

**Current Code**:
```javascript
// Line 670-681: Checks if creature still in battle list
const stillInBattleList = currentBattleListNames.some(blName => 
  isBattleListMatch(oldCreature.name, blName)
);

if (!stillInBattleList) {
  continue; // Skip dead creatures
}

// Line 686-693: Matches closest health bar
for (const hb of healthBars) {
  if (matchedHealthBars.has(hb)) continue;
  const distance = screenDist(hb, oldCreature.absoluteCoords);
  if (distance < minDistance) {
    minDistance = distance;
    bestMatchHb = hb;
  }
}
```

**Bug**: `stillInBattleList` returns `true` if ANY "Dragon" exists, but doesn't track HOW MANY Dragons exist vs matched.

**Fix Required**:
```javascript
// After battle list check, count instances by name
const battleListCountByName = new Map();
for (const blName of currentBattleListNames) {
  battleListCountByName.set(blName, (battleListCountByName.get(blName) || 0) + 1);
}

// After matching all health bars, check per-name counts
const matchedCountByName = new Map();
for (const creature of newActiveCreatures.values()) {
  if (creature.name) {
    matchedCountByName.set(creature.name, (matchedCountByName.get(creature.name) || 0) + 1);
  }
}

// For unmatched creatures, only keep if count mismatch
for (const [id, oldCreature] of activeCreatures.entries()) {
  if (!newActiveCreatures.has(id) && oldCreature.name) {
    const blCount = battleListCountByName.get(oldCreature.name) || 0;
    const matchedCount = matchedCountByName.get(oldCreature.name) || 0;
    
    if (blCount > matchedCount) {
      // Keep as positionUncertain - we're missing health bars
      oldCreature.positionUncertain = true;
      newActiveCreatures.set(id, oldCreature);
      matchedCountByName.set(oldCreature.name, matchedCount + 1);
    }
    // else: DELETE - this creature died
  }
}
```

---

### BUG #2: Sticky Snap Causes Wrong Creature Clicks (HIGH)
**Location**: Lines 252-262, then consumed by targetingWorker at click time

**Problem**: When two creatures are within 0.5 tiles of each other, sticky snap prevents position updates, causing clicks to land on wrong creature.

**Scenario**:
```
Swamp Troll at (100, 100) - in battle list
Player at (101, 100) - NOT in battle list
Swamp Troll moves to (101.4, 100.2)

Sticky snap logic:
  distX = |101.4 - 100| = 1.4 tiles
  distY = |100.2 - 100| = 0.2 tiles
  
  distY < 0.5 → keep Y = 100 ✓
  distX > 0.5 → update X = 101 ✓
  
Result: Swamp Troll reported at (101, 100)
        Player also at (101, 100)
        
When targeting clicks (101, 100) on screen → clicks player instead of troll
```

**Current Code**:
```javascript
// Lines 252-262
const distX = Math.abs(rawGameCoordsFloat.x - creature.gameCoords.x);
const distY = Math.abs(rawGameCoordsFloat.y - creature.gameCoords.y);
if (
  distX < STICKY_SNAP_THRESHOLD_TILES &&
  distY < STICKY_SNAP_THRESHOLD_TILES
) {
  intermediateX = creature.gameCoords.x;
  intermediateY = creature.gameCoords.y;
}
```

**Bug**: Sticky snap keeps old coordinates even when creature moved to position occupied by another entity.

**Fix Required**: 
```javascript
// After sticky snap, check if resulting position conflicts with known entities
const snappedCoords = { x: intermediateX, y: intermediateY, z: currentPlayerMinimapPosition.z };

// Check if any other active creature already at this position
const positionOccupied = Array.from(activeCreatures.values()).some(c => 
  c.instanceId !== creature.instanceId &&
  c.gameCoords?.x === snappedCoords.x &&
  c.gameCoords?.y === snappedCoords.y &&
  c.gameCoords?.z === snappedCoords.z
);

if (positionOccupied) {
  // Use raw coordinates instead of snapped - position actually changed
  intermediateX = Math.floor(rawGameCoordsFloat.x);
  intermediateY = Math.floor(rawGameCoordsFloat.y);
}
```

---

### BUG #3: Nameplate Occlusion by Other Nameplates (MEDIUM)
**Location**: Lines 650-661 (OCR for health bars), Lines 365-377 (name matching)

**Problem**: When creatures with long names stand in a row, nameplates overlap. OCR reads middle of nameplate, getting partial/mangled data.

**Scenario**:
```
Creatures standing in row:
  - "Ancient Scarab" nameplate
  - "Emerald Damselfly" nameplate (overlaps above)
  
OCR result: "rald Dam" (middle portion read)

Matching logic:
  - "rald Dam" vs "Emerald Damselfly" → similarity 0.6 → MATCH ✓
  - "rald Dam" vs "Ancient Scarab" → similarity 0.3 → NO MATCH
  
But what if we have:
  - "Herald Damos" (similar partial name)
  - "Emerald Damselfly"
  
OCR reads "rald Dam" → might match wrong creature
```

**Current Code**:
```javascript
// Line 373: Similarity threshold 0.5
if (score > 0.5 && score > highestScore) {
  highestScore = score;
  bestBar = data.hb;
}
```

**Bug**: When multiple creatures have similar partial names, wrong creature might win similarity contest.

**Fix Required**:
```javascript
// Improve matching by checking if partial OCR is UNIQUE substring
const uniqueMatch = (ocrText, canonicalNames) => {
  const matches = canonicalNames.filter(name => 
    cleanName(name).includes(cleanName(ocrText))
  );
  
  if (matches.length === 1) {
    // Unique substring match - high confidence
    return { name: matches[0], confidence: 0.95 };
  } else if (matches.length > 1) {
    // Ambiguous - fall back to similarity scoring
    // But boost threshold to reduce false matches
    return findBestNameMatch(ocrText, matches, 0.7); // Higher threshold
  } else {
    // No substring match - use fuzzy matching
    return findBestNameMatch(ocrText, canonicalNames, 0.55);
  }
};
```

---

### BUG #4: Creatures Not in Targeting List (MEDIUM)
**Location**: Lines 556-587, Lines 641-648 (canonical names construction)

**Problem**: Battle list shows only targetable creatures. We might detect creatures NOT in targeting list (e.g., other players, NPCs, summoned creatures). These are ignored or cause mismatches.

**Scenario**:
```
Battle List: Demon (targetable)
Health Bars Detected: 2
  - Health bar 1 → OCR: "Demon"
  - Health bar 2 → OCR: "OtherPlayer"

Canonical names = ["Demon"] (from targeting list + battle list)

Health bar 2 tries to match "OtherPlayer" vs ["Demon"]
  → No match (similarity too low)
  → Health bar 2 ignored
  
But health bar 2 is REAL, just not in targeting list.

Later: Battle list count (1) vs detected count (1) → matches
        But we saw 2 health bars → data inconsistency
```

**Current Code**:
```javascript
// Lines 641-648: Only targeting list + battle list names
const canonicalNames = [
  ...new Set([
    ...explicitTargetNames,  // From targeting list
    ...battleListNames,      // From battle list OCR
  ]),
];
```

**Bug**: Creatures not in either list are silently dropped, but they might block pathing or cause position confusion.

**Fix Required**:
```javascript
// For unmatched health bars with valid OCR, create "unnamed" creatures
for (const hb of unmatchedHealthBars) {
  const rawOcr = await getRawOcrForHealthBar(hb);
  
  if (rawOcr && rawOcr.length >= 3) {
    // Try to match to canonical names first
    const match = findBestNameMatch(rawOcr, canonicalNames, 0.55);
    
    if (!match) {
      // Create creature with OCR name, mark as non-targetable
      const detection = {
        absoluteCoords: { x: hb.x, y: hb.y },
        healthBarY: hb.y,
        name: rawOcr, // Keep OCR name even if not in targeting list
        hp: hb.healthTag,
        nonTargetable: true, // Flag for targeting to ignore
      };
      
      const newId = nextInstanceId++;
      let newCreature = { instanceId: newId };
      
      newCreature = updateCreatureState(/* ... */);
      
      if (newCreature) {
        newActiveCreatures.set(newId, newCreature);
        matchedHealthBars.add(hb);
      }
    }
  }
}
```

---

### BUG #5: Position Uncertain Logic Incorrect (HIGH)
**Location**: Lines 772-794

**Problem**: Since detection is 100% accurate, "positionUncertain" should NEVER exist except in multi-creature-same-name scenario (BUG #1). Current logic keeps creatures for 2s even when they're dead.

**Scenario**:
```
Dragon dies, health bar disappears.
Battle list updates: Dragon removed (0ms delay)
Health bar detection: No Dragon health bar

Current logic (lines 772-794):
  - Battle list has 0 Dragons
  - Detected 0 Dragons  
  - blCount (0) > detectedCount (0)? NO
  - Should delete Dragon

BUT if Dragon instanceId wasn't matched in STAGE 1 (lines 670-718):
  - It falls through to lines 772-794
  - Gets kept as positionUncertain for 2s ✗
```

**Current Code**:
```javascript
// Lines 772-794
for (const [id, oldCreature] of activeCreatures.entries()) {
  if (!newActiveCreatures.has(id) && oldCreature.name) {
    const blCount = blCounts.get(oldCreature.name) || 0;
    const detectedCount = detectedCounts.get(oldCreature.name) || 0;

    if (blCount > detectedCount) {
      // Keep as positionUncertain
      if (!oldCreature.positionUncertain) {
        oldCreature.positionUncertainSince = now;
      }
      oldCreature.positionUncertain = true;
      
      if (now - (oldCreature.positionUncertainSince || now) < 2000) {
        newActiveCreatures.set(id, oldCreature);
      }
    }
  }
}
```

**Bug**: 2s timeout is too long and shouldn't exist. If health bar missing and detection is 100% accurate → creature is dead.

**Fix Required**:
```javascript
// Replace with immediate rescan trigger
if (blCount > detectedCount) {
  // We're missing health bars for creatures in battle list
  // This should NEVER happen with 100% accurate detection
  // Force immediate full rescan
  console.warn(`[CreatureMonitor] Missing health bars: expected ${blCount} ${oldCreature.name}, detected ${detectedCount}`);
  
  // Trigger rescan by marking regions stale
  regionsStale = true;
  parentPort.postMessage({ type: 'request_regions_snapshot' });
  
  // Keep creature for ONE more frame only
  if (!oldCreature.rescanPending) {
    oldCreature.rescanPending = true;
    oldCreature.rescanTime = now;
    newActiveCreatures.set(id, oldCreature);
  } else if (now - oldCreature.rescanTime < 100) {
    // Still waiting for rescan (< 100ms)
    newActiveCreatures.set(id, oldCreature);
  }
  // else: Delete - rescan didn't find it, must be dead
}
```

---

### BUG #6: Target Unification Precedence Wrong (CRITICAL)
**Location**: Lines 943-963

**Problem**: Game world target takes precedence over battle list target, but battle list is 100% accurate. Should be reversed.

**Scenario**:
```
Battle List: Targeting "Dragon" (red marker at Dragon entry)
Game World: Target box detected, closest creature is "Ancient Scarab" (within 1.0 tiles)

Current logic (lines 944-958):
  if (gameWorldTarget) {
    unifiedTarget = gameWorldTarget; // Uses Ancient Scarab ✗
  } else if (battleListTargetEntry) {
    unifiedTarget = battleListTarget; // Would use Dragon ✓
  }

Result: Targeting system thinks we're attacking Ancient Scarab, but we're actually attacking Dragon
        → Stance/distance logic applies to wrong creature
        → Movement goes to wrong position
```

**Current Code**:
```javascript
// Lines 943-958
let unifiedTarget = null;
if (gameWorldTarget) {
  unifiedTarget = gameWorldTarget; // Game world takes precedence ✗
} else if (battleListTargetEntry) {
  const match = detectedEntities.find(c => isBattleListMatch(c.name, battleListTargetEntry.name));
  if (match) {
    unifiedTarget = { /* battle list target */ };
  }
}
```

**Bug**: Game world target uses distance < 1.0 heuristic which can be wrong when creatures are stacked.

**Fix Required**:
```javascript
// REVERSE: Battle list takes precedence (100% accurate)
let unifiedTarget = null;

if (battleListTargetEntry) {
  // Battle list shows target - use it (100% certainty)
  const match = detectedEntities.find(c => isBattleListMatch(c.name, battleListTargetEntry.name));
  
  if (match) {
    unifiedTarget = {
      instanceId: match.instanceId,
      name: match.name,
      hp: match.hp,
      distance: parseFloat(match.distance.toFixed(1)),
      gameCoordinates: match.gameCoords,
      isReachable: match.isReachable,
    };
  } else {
    // Battle list shows target but we don't have creature in gameWorld
    // Check if target box confirms it exists
    if (gameWorldTarget) {
      // Target exists but we don't have its creature data
      // Update creature from battle list name
      console.warn(`[CreatureMonitor] Target ${battleListTargetEntry.name} in battle list but not in creatures. Using target box coords.`);
      
      unifiedTarget = {
        instanceId: 0, // Temporary - will be resolved next frame
        name: battleListTargetEntry.name,
        hp: 'Unknown',
        distance: 0,
        gameCoordinates: gameWorldTarget.gameCoordinates,
        isReachable: false, // Unknown
      };
    }
  }
} else if (gameWorldTarget) {
  // No battle list target, use game world (user manually clicked)
  unifiedTarget = gameWorldTarget;
}
```

---

### BUG #7: Garbled OCR Not Handled Optimally (LOW)
**Location**: Lines 365-377 (name matching in STAGE 2)

**Problem**: When OCR is garbled but we have exactly 1 unaccounted creature in battle list, we should confidently match them. Currently doesn't do this.

**Scenario**:
```
Battle List: Demon, Dragon, Ancient Scarab (3 total)
Detected creatures: 
  - Demon (matched) ✓
  - Dragon (matched) ✓
  - Health bar with OCR "Anc##t Sc@r@b" (mangled)

Current logic:
  - Try to match "Anc##t Sc@r@b" vs ["Demon", "Dragon", "Ancient Scarab"]
  - Similarity vs "Ancient Scarab" = 0.52 (below 0.55 threshold)
  - No match → Health bar ignored ✗

Battle list count: 3
Detected count: 2
Missing: 1

We KNOW the mangled name must be "Ancient Scarab" (only unaccounted creature)
```

**Fix Required**:
```javascript
// After normal OCR matching fails, do deductive matching
const unmatchedAfterOcr = unmatchedHealthBars.filter(hb => !matchedHealthBars.has(hb));

if (unmatchedAfterOcr.length > 0 && battleListEntries.length > 0) {
  // Count what we're missing
  const battleListCounts = new Map();
  for (const entry of battleListEntries) {
    const name = entry.name.replace(/\.\.\.$/, ''); // Remove truncation
    battleListCounts.set(name, (battleListCounts.get(name) || 0) + 1);
  }
  
  const detectedCounts = new Map();
  for (const creature of newActiveCreatures.values()) {
    if (creature.name) {
      detectedCounts.set(creature.name, (detectedCounts.get(creature.name) || 0) + 1);
    }
  }
  
  const unaccountedNames = [];
  for (const [name, blCount] of battleListCounts.entries()) {
    const detCount = detectedCounts.get(name) || 0;
    for (let i = 0; i < blCount - detCount; i++) {
      unaccountedNames.push(name);
    }
  }
  
  // If exactly 1 unmatched health bar and 1 unaccounted name → match them
  if (unmatchedAfterOcr.length === 1 && unaccountedNames.length === 1) {
    const hb = unmatchedAfterOcr[0];
    const name = unaccountedNames[0];
    
    console.log(`[CreatureMonitor] Deductive match: health bar → ${name} (only unaccounted creature)`);
    
    const detection = {
      absoluteCoords: { x: hb.x, y: hb.y },
      healthBarY: hb.y,
      name: name, // Use battle list name, ignore garbled OCR
      hp: hb.healthTag,
    };
    
    const newId = nextInstanceId++;
    let newCreature = { instanceId: newId };
    newCreature = updateCreatureState(/* ... */);
    
    if (newCreature) {
      newActiveCreatures.set(newId, newCreature);
      matchedHealthBars.add(hb);
    }
  }
}
```

---

## SUMMARY OF FIXES

### Priority 1 (CRITICAL - Fix Immediately)
1. **BUG #1**: Multiple creatures same name → Add per-name instance counting
2. **BUG #6**: Target unification → Reverse precedence (battle list first)

### Priority 2 (HIGH - Fix Soon)
3. **BUG #2**: Sticky snap wrong clicks → Add position conflict detection
4. **BUG #5**: Position uncertain → Replace 2s timeout with immediate rescan

### Priority 3 (MEDIUM - Fix When Possible)
5. **BUG #3**: Nameplate occlusion → Improve partial name matching
6. **BUG #4**: Non-targetable creatures → Create "unnamed" creatures

### Priority 4 (LOW - Optimization)
7. **BUG #7**: Garbled OCR → Add deductive matching

---

## ROOT CAUSE OF YOUR REPORTED BUGS

### "Targeting Wrong Creature"
**Root Cause**: BUG #6 (target unification precedence) + BUG #2 (sticky snap)
- Game world target uses closest-within-1.0-tile heuristic
- When creatures are stacked or adjacent, picks wrong one
- Battle list knows exact target but is ignored

### "Swapping Creature Identities"
**Root Cause**: BUG #1 (multiple creatures same name)
- Three "Dragon" creatures exist
- One dies but other two both say "stillInBattleList = true"
- Health bar matching doesn't enforce 1-to-1 mapping per name
- Dead Dragon's instanceId given to alive Dragon

### "Random Retargeting"
**Root Cause**: BUG #5 (position uncertain logic) + BUG #1 interaction
- Creature flickers between valid and positionUncertain states
- TargetingWorker sees creature disappear/reappear
- Triggers state transition ENGAGING → SELECTING → ENGAGING
- Appears as "random retargeting"

---

## TESTING VERIFICATION

After fixes, verify:
1. ✅ Spawn 3 creatures with same name, kill 1 → other 2 keep correct instanceIds
2. ✅ Creature adjacent to player → clicks correct creature, not player
3. ✅ Battle list shows target → targeting uses battle list, not game world guess
4. ✅ Mangled nameplate with 1 unaccounted battle list entry → deductive match works
5. ✅ Health bar disappears → creature deleted immediately, no 2s ghost period
