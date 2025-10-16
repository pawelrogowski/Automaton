# CreatureMonitor.js Detection Pipeline - Complete Assumption Analysis

## Executive Summary
This document lists **every assumption** the `creatureMonitor.js` makes when detecting creatures and producing data for `targetingWorker.js`. Each assumption is a potential failure point that can cause targeting bugs.

---

## 1. HEALTH BAR DETECTION PHASE (lines 595-632)

### 1.1 Visual Detection Assumptions
- **ASSUMPTION**: All creatures have a visible health bar on screen
  - **FAILS WHEN**: Creature is behind obstacles, in fog of war, or UI element overlaps
  - **BUG IMPACT**: Creature exists but isn't detected → targeting ignores it

- **ASSUMPTION**: Health bar detection from native module is 100% accurate
  - **FAILS WHEN**: Similar colored pixels create false positives
  - **BUG IMPACT**: Phantom creatures detected → targeting tries to attack non-existent targets

- **ASSUMPTION**: Health bars are within the constrained game world region (line 589-593)
  - **FAILS WHEN**: Creatures at extreme screen edges have health bars cut off
  - **BUG IMPACT**: Edge creatures ignored even when targetable

- **ASSUMPTION**: findHealthBars returns health bars at exact pixel positions
  - **FAILS WHEN**: Sub-pixel rendering or anti-aliasing shifts positions
  - **BUG IMPACT**: Screen-to-game-coord conversion uses wrong coordinates

### 1.2 Player Health Bar Filter (lines 603-632)
- **ASSUMPTION**: Player's health bar appears at player's exact minimap position
  - **FAILS WHEN**: Animation freeze logic causes position mismatch (line 229-231)
  - **BUG IMPACT**: Player's health bar creates a "phantom creature" at player position

- **ASSUMPTION**: Round(gameCoords) == player position catches all player health bars
  - **FAILS WHEN**: Sub-tile positioning or rounding errors cause off-by-one
  - **BUG IMPACT**: Player health bar treated as creature, targeting tries to attack self

---

## 2. BATTLE LIST OCR PHASE (lines 136-173, 476-491)

### 2.1 OCR Accuracy Assumptions
- **ASSUMPTION**: Battle list OCR correctly recognizes all creature names
  - **FAILS WHEN**: 
    - Name contains uncommon characters
    - Font rendering differs from training data
    - Screen scaling/resolution changes
    - Motion blur during OCR frame capture
  - **BUG IMPACT**: Name mismatch → creature detection fails → targeting ignores creature

- **ASSUMPTION**: Battle list truncation always uses "..." pattern (line 330-332)
  - **FAILS WHEN**: Different Tibia versions use different truncation
  - **BUG IMPACT**: Name matching fails → creature not identified

- **ASSUMPTION**: Case-fixing regex `([a-z])([A-Z])` catches all OCR errors (line 157)
  - **FAILS WHEN**: OCR produces "DragonLord" → "Dragon Lord" works, but "DRAGONLord" fails
  - **BUG IMPACT**: Name mismatch → identification failure

### 2.2 Battle List State Assumptions
- **ASSUMPTION**: Battle list is re-scanned every 500ms OR when dirty rects overlap (line 476-478)
  - **FAILS WHEN**: 
    - Creature spawns + battle list updates < 500ms apart
    - Dirty rect detection misses battle list region
  - **BUG IMPACT**: Stale battle list → using old creature count → wrong identification

- **ASSUMPTION**: Battle list decreasing = something died (line 528)
  - **FAILS WHEN**: 
    - Creature walks out of range
    - Player teleports away
    - Creature becomes invisible
  - **BUG IMPACT**: False loot trigger

- **ASSUMPTION**: Battle list order is consistent between frames
  - **NO GUARANTEE**: Tibia server can reorder battle list arbitrarily
  - **BUG IMPACT**: Battle list click targeting (now disabled) would click wrong creature

---

## 3. CREATURE IDENTITY ASSIGNMENT (lines 312-407, 663-736)

### 3.1 Two-Stage Matching Logic Assumptions

#### STAGE 1: Existing Creature Tracking (lines 663-718)
- **ASSUMPTION**: Closest health bar within 200px belongs to same creature (line 51, 684)
  - **FAILS WHEN**: 
    - Two creatures of same type move within 200px of each other
    - One creature dies, another spawns nearby
  - **BUG IMPACT**: **IDENTITY SWAP** - instanceId transfers to wrong creature

- **CRITICAL ASSUMPTION**: Creature still in battle list → keep its instanceId (lines 670-681)
  - **PARTIALLY CORRECT**: Checks battle list before matching
  - **STILL FAILS WHEN**: 
    - Two "Dragon" creatures exist
    - One dies, battle list still has "Dragon" 
    - Dead Dragon's health bar now closest to alive Dragon
  - **BUG IMPACT**: Dead creature's instanceId assigned to alive creature → targeting confused

- **ASSUMPTION**: Name from previous frame is correct and can be trusted (line 699)
  - **FAILS WHEN**: Previous frame had OCR error or wrong identity assignment
  - **BUG IMPACT**: Propagates identity errors across frames

#### STAGE 2: New Creature Identification (lines 720-736)
- **ASSUMPTION**: Battle list count - identified count = number of new creatures (lines 343-351)
  - **FAILS WHEN**: 
    - Battle list OCR missed a creature
    - Multiple creatures of same type spawn simultaneously
  - **BUG IMPACT**: Under/over identification of new creatures

- **ASSUMPTION**: Nameplate OCR matches canonical names with >50% similarity (line 373)
  - **FAILS WHEN**: 
    - Nameplate partially occluded by terrain
    - Name contains special characters OCR mangles
    - Very short names (< 3 chars) rejected (line 92 in nameMatcher.js)
  - **BUG IMPACT**: New creature assigned wrong name or no name

- **ASSUMPTION**: Best OCR match is the correct creature (lines 365-377)
  - **FAILS WHEN**: 
    - Two similar-named creatures spawn together ("Dragon" vs "Dragon Lord")
    - OCR reads "Dragon Lo" → matches either with similar score
  - **BUG IMPACT**: Wrong creature type assigned → wrong targeting priority

### 3.2 Name Matching Heuristics (nameMatcher.js)
- **ASSUMPTION**: Similarity score >0.55 means correct match (line 124)
  - **ARBITRARY THRESHOLD**: Based on testing, no formal proof
  - **FAILS WHEN**: Two creature types have similar names

- **ASSUMPTION**: Levenshtein + LCS hybrid catches all OCR errors (line 117)
  - **FAILS WHEN**: OCR produces completely garbled output
  - **BUG IMPACT**: No match found → creature unidentified

---

## 4. POSITION CALCULATION (lines 216-309)

### 4.1 Screen-to-Game Coordinate Conversion
- **ASSUMPTION**: getGameCoordinatesFromScreen is accurate (line 232-238)
  - **DEPENDS ON**: 
    - Correct tile size measurement
    - Correct game world region coordinates
    - Correct player minimap position
  - **FAILS WHEN**: Any dependency is wrong
  - **BUG IMPACT**: Creature placed at wrong game coordinates

- **ASSUMPTION**: Health bar center + 14px + tileHeight/2 = creature center (line 228)
  - **MAGIC NUMBERS**: Based on empirical measurement
  - **FAILS WHEN**: Game client scales UI differently
  - **BUG IMPACT**: Off-by-one tile errors in position

### 4.2 Animation Freeze Logic (lines 48, 229-231, 456-466)
- **ASSUMPTION**: Player position change freezes creature positions for 25ms (line 48)
  - **RATIONALE**: Prevents jitter during player movement animation
  - **FAILS WHEN**: Animation takes longer (lag, diagonal movement)
  - **BUG IMPACT**: Creatures "snap" to wrong positions after freeze ends

- **ASSUMPTION**: lastStablePlayerMinimapPosition is always valid
  - **FAILS WHEN**: First frame after worker init (line 67 default {0,0,0})
  - **BUG IMPACT**: All creatures positioned relative to 0,0,0 for first 25ms

### 4.3 Sticky Snap Logic (lines 49, 252-262)
- **ASSUMPTION**: Creature position within 0.5 tiles = same creature (line 49)
  - **RATIONALE**: Prevents jitter from screen coordinate measurement errors
  - **FAILS WHEN**: Creature actually moved < 0.5 tiles (diagonal walk)
  - **BUG IMPACT**: Position lags behind actual position by 1 frame

### 4.4 Jitter Confirmation (lines 50, 268-284)
- **ASSUMPTION**: Position change unconfirmed for 75ms prevents jitter (line 50)
  - **RATIONALE**: Requires position to be stable for 75ms before accepting change
  - **FAILS WHEN**: Creature walks continuously (position changes every 50ms)
  - **BUG IMPACT**: Position always 1-2 tiles behind actual position

---

## 5. STAGE 3: CREATURE LIFECYCLE (lines 738-795)

### 5.1 Disappearance Detection
- **ASSUMPTION**: Creature not in battle list = died (lines 743-751)
  - **FAILS WHEN**: 
    - Battle list OCR failed for that creature
    - Creature became invisible
    - Creature teleported away
  - **BUG IMPACT**: Valid creature deleted → targeting loses target

### 5.2 Position Uncertain Logic (lines 772-794)
- **ASSUMPTION**: Creature in battle list but no health bar → keep for 2s (line 785)
  - **RATIONALE**: Health bar might be temporarily occluded
  - **FAILS WHEN**: Health bar genuinely missing (dead, out of range)
  - **BUG IMPACT**: Ghost creatures persist for 2s, targeting tries to attack air

- **ASSUMPTION**: Battle list count - detected count means missing creatures exist (lines 774-777)
  - **FAILS WHEN**: 
    - Battle list has duplicate names (OCR error)
    - Battle list count is wrong
  - **BUG IMPACT**: Creates phantom "positionUncertain" creatures

---

## 6. REACHABILITY CALCULATION (lines 801-859)

### 6.1 Pathfinder Assumptions
- **ASSUMPTION**: pathfinderInstance.getReachableTiles is accurate (line 837)
  - **DEPENDS ON**: Walkable tile map being up-to-date with server
  - **FAILS WHEN**: 
    - Map data outdated (new obstacles added to game)
    - Dynamic obstacles (magic walls, fire fields)
    - Other creatures blocking path
  - **BUG IMPACT**: Unreachable creature marked reachable → targeting walks into walls

- **ASSUMPTION**: Screen bounds 7x5 tiles covers all on-screen creatures (lines 803-808)
  - **HARDCODED**: Based on standard game client size
  - **FAILS WHEN**: Client resolution/zoom changes
  - **BUG IMPACT**: Off-screen creatures marked unreachable even if visible

### 6.2 Reachability Caching (lines 70-72, 809-843)
- **ASSUMPTION**: Reachability only changes when positions change (line 834)
  - **OPTIMIZATION**: Avoids expensive pathfinding recalculation
  - **FAILS WHEN**: 
    - Dynamic obstacles appear (magic wall)
    - Creature blocks/unblocks path
  - **BUG IMPACT**: Stale reachability → targeting tries to reach unreachable creature

- **ASSUMPTION**: Numeric hash signature is collision-free (lines 810-832)
  - **MATH**: 32-bit hash of all positions
  - **FAILS WHEN**: Hash collision (rare but possible)
  - **BUG IMPACT**: Wrong reachability cache used

### 6.3 Position Uncertain → Unreachable (line 847-849)
- **ASSUMPTION**: Uncertain position = unreachable
  - **CORRECT LOGIC**: Can't pathfind to unknown position
  - **BUG IMPACT**: Creature becomes untargetable for 2s even if reachable

---

## 7. TARGET DETECTION (lines 867-963)

### 7.1 Game World Target Box Detection (lines 874-917)
- **ASSUMPTION**: findTarget native module accurately finds target box
  - **FAILS WHEN**: 
    - Target box color changes (different creature types)
    - Overlapping UI elements
    - Screen effects (flashing, damage numbers)
  - **BUG IMPACT**: Wrong target detected or no target detected

- **ASSUMPTION**: Target box center → game coords → closest creature = actual target (lines 894-904)
  - **USES**: Distance < 1.0 tile threshold (line 899)
  - **FAILS WHEN**: 
    - Multiple creatures stacked on same tile
    - Target box position offset from creature position
  - **BUG IMPACT**: Wrong creature identified as target

### 7.2 Battle List Target Detection (lines 919-941)
- **ASSUMPTION**: Red vertical sequence in battle list = target marker (lines 922-928)
  - **FRAGILE**: Depends on exact pixel color matching
  - **FAILS WHEN**: 
    - UI theme changes
    - Screen color calibration differences
    - Marker animation in progress
  - **BUG IMPACT**: No target detected even when target exists

- **ASSUMPTION**: Closest battle list entry to marker Y = target (lines 931-939)
  - **USES**: Distance < 20px threshold (line 937)
  - **FAILS WHEN**: Battle list has large gaps between entries
  - **BUG IMPACT**: Wrong creature identified as target

### 7.3 Target Unification (lines 943-963)
- **ASSUMPTION**: Game world target takes precedence over battle list (lines 944-958)
  - **DESIGN DECISION**: Game world is more reliable
  - **FAILS WHEN**: Game world detection is wrong but battle list correct
  - **BUG IMPACT**: Wrong target propagated to targeting system

- **ASSUMPTION**: Target must exist in creatures array (lines 960-962)
  - **SAFETY CHECK**: Prevents phantom targets
  - **FAILS WHEN**: Target detection happens before creature identification
  - **BUG IMPACT**: Valid target ignored because timing mismatch

---

## 8. DATA SERIALIZATION TO SAB (lines 972-1012)

### 8.1 Array Truncation
- **ASSUMPTION**: First 100 creatures covers all relevant creatures (line 984)
  - **FAILS WHEN**: >100 creatures on screen (massive spawn)
  - **BUG IMPACT**: Creatures beyond 100 invisible to targeting

- **ASSUMPTION**: First 50 battle list entries covers all (line 999)
  - **FAILS WHEN**: >50 entries (rare in normal gameplay)
  - **BUG IMPACT**: Late battle list entries lost

### 8.2 Data Type Conversions
- **ASSUMPTION**: distance * 100 fits in INT32 (line 994)
  - **FAILS WHEN**: Distance > 21,474,836 tiles (never happens)
  - **BUG IMPACT**: None (safe)

- **ASSUMPTION**: HP string "Obstructed" → 0 (line 995)
  - **FAILS WHEN**: New HP string types added
  - **BUG IMPACT**: targetingWorker sees hp=0, treats as unknown

### 8.3 Coordinate Precision Loss
- **ASSUMPTION**: Math.round(screenCoords) preserves enough precision (line 289-291)
  - **LOSES**: Sub-pixel information
  - **BUG IMPACT**: Clicking slightly off-center of creature hitbox

---

## 9. TARGETING WORKER CONSUMPTION (targetingWorker.js)

### 9.1 SAB Read Assumptions
- **ASSUMPTION**: SAB data is consistent within single read (lines 79-93)
  - **FAILS WHEN**: creatureMonitor writes while targetingWorker reads
  - **MITIGATION**: Version counters (but not always checked)
  - **BUG IMPACT**: Torn reads → corrupted creature data

- **ASSUMPTION**: distance / 100 reverses the *100 from creatureMonitor (line 85)
  - **CORRECT**: Math is reversible
  - **BUG IMPACT**: None

### 9.2 Instance ID Assumptions
- **CRITICAL ASSUMPTION**: instanceId uniquely identifies a creature across frames
  - **FAILS WHEN**: Identity swap in creatureMonitor (see 3.1)
  - **BUG IMPACT**: Targeting thinks it's attacking X, actually attacking Y

- **ASSUMPTION**: instanceId=0 means no target (line 100)
  - **CONVENTION**: Established in schema.js
  - **FAILS WHEN**: Never (safe convention)

### 9.3 Target Acquisition (targetingLogic.js lines 152-199)
- **ASSUMPTION**: Clicking absoluteX/absoluteY acquires that instanceId (lines 178-196)
  - **FAILS WHEN**: 
    - Screen shifted between detection and click
    - Creature moved since last detection frame
    - Another creature overlaps click position
  - **BUG IMPACT**: Clicks wrong creature or empty space

- **ASSUMPTION**: Target acquisition is verified by checking SAB target after click (lines 159-175)
  - **RACE CONDITION**: Click → game processes → target updates → SAB reads
  - **FAILS WHEN**: Verification happens before game updates target
  - **BUG IMPACT**: False negative → retargets unnecessarily

---

## 10. TEMPORAL ASSUMPTIONS

### 10.1 Frame Timing
- **ASSUMPTION**: performOperation runs ~20Hz (implied by worker loop)
  - **FAILS WHEN**: System lag causes frame skips
  - **BUG IMPACT**: Position tracking breaks, jitter confirmation times out

- **ASSUMPTION**: Battle list OCR completes within one frame (~50ms)
  - **FAILS WHEN**: OCR takes >50ms (rare but possible)
  - **BUG IMPACT**: Blocks performOperation, other detections delayed

### 10.2 State Consistency
- **ASSUMPTION**: Player position updates before creature detection (line 442-454)
  - **NOT GUARANTEED**: Position comes from SAB, timing depends on minimapMonitor
  - **FAILS WHEN**: minimapMonitor lags behind creatureMonitor
  - **BUG IMPACT**: Creatures positioned relative to stale player position

### 10.3 Looting Blocking (lines 554, 527-539)
  - **ASSUMPTION**: looting flag prevents double-targeting during loot animation
  - **FAILS WHEN**: Loot animation completes before flag clears
  - **BUG IMPACT**: Targets creature mid-loot, movement conflicts

---

## 11. CONFIGURATION ASSUMPTIONS

### 11.1 Magic Constants
- `PLAYER_ANIMATION_FREEZE_MS = 25` (line 48)
- `STICKY_SNAP_THRESHOLD_TILES = 0.5` (line 49)
- `JITTER_CONFIRMATION_TIME_MS = 75` (line 50)
- `CORRELATION_DISTANCE_THRESHOLD_PIXELS = 200` (line 51)

**ASSUMPTION**: These values work for all gameplay scenarios
**FAILS WHEN**: Lag, unusual movement patterns, different game client settings
**BUG IMPACT**: Position tracking becomes unreliable

### 11.2 Region Coordinates
- **ASSUMPTION**: regionCoordinates from regionMonitor are pixel-perfect (line 420)
- **FAILS WHEN**: 
  - Window resized
  - UI scale changed
  - Game client updated with new UI layout
- **BUG IMPACT**: All screen-to-game coordinate conversions break

---

## 12. TARGETING LOGIC ASSUMPTIONS (targetingLogic.js)

### 12.1 Best Target Selection (lines 76-146)
- **ASSUMPTION**: isReachable + !positionUncertain = valid target (line 86)
  - **CORRECT**: Aligns with creatureMonitor output
  - **BUG IMPACT**: If creatureMonitor wrong about reachability, targeting picks unreachable target

- **ASSUMPTION**: Adjacent targets prioritized over distant (lines 97-102)
  - **DESIGN DECISION**: Melee optimization
  - **FAILS WHEN**: User wants ranged targeting priority
  - **BUG IMPACT**: Ignores better distant target for worse adjacent one

### 12.2 Target Stickiness (lines 105-129)
- **ASSUMPTION**: Only switch if new target has HIGHER priority (line 115)
  - **PREVENTS**: Thrashing between equal-priority targets
  - **FAILS WHEN**: Same-priority creature closer/more relevant
  - **BUG IMPACT**: Keeps attacking far creature when near one spawns

### 12.3 Target Verification (targetingWorker.js lines 159-175)
- **ASSUMPTION**: WRONG_INSTANCE with same name = acceptable (lines 343-356)
  - **RATIONALE**: Multiple "Dragon" creatures, any Dragon is fine
  - **FAILS WHEN**: Dragons have different HP, one is low → targeting wrong one
  - **BUG IMPACT**: Doesn't finish off wounded creature, attacks fresh one

---

## ROOT CAUSE ANALYSIS OF REPORTED BUGS

### Bug: Targeting Wrong Creature
**LIKELY CAUSE**: 
1. Identity swap in STAGE 1 (line 684) - closest health bar heuristic fails when creatures overlap
2. Name matching assigns wrong name in STAGE 2 (line 373) - similar creature names
3. Target box detection (line 899) matches wrong creature when stacked

### Bug: Swapping Creature Identities  
**LIKELY CAUSE**:
1. **CRITICAL**: Lines 670-681 check battle list but not instance uniqueness
   - Scenario: Dragon1 dies, Dragon2 exists, Dragon1's health bar now closest to Dragon2
   - Result: Dragon1's instanceId given to Dragon2
2. Sticky snap + jitter confirmation delay position updates → health bar correlation breaks

### Bug: Random Retargeting
**LIKELY CAUSE**:
1. Position uncertain logic (lines 778-794) alternates creature between valid/invalid
2. Reachability cache stale (line 834) → creature flips reachable/unreachable
3. Battle list OCR flickering → creature appears/disappears from battle list → deleted/recreated
4. Target verification timeout (line 360) → targeting thinks acquisition failed → retries

---

## RECOMMENDED FIXES (Prioritized by Impact)

### CRITICAL: Fix Identity Swap
**Problem**: Lines 670-681 - checking battle list isn't enough
**Solution**: Add uniqueness constraint:
```javascript
// After line 681, before matching health bars
const instancesInBattleList = new Map(); // name -> array of instanceIds
for (const [id, oldCreature] of activeCreatures.entries()) {
  if (oldCreature.name && stillInBattleList) {
    if (!instancesInBattleList.has(oldCreature.name)) {
      instancesInBattleList.set(oldCreature.name, []);
    }
    instancesInBattleList.get(oldCreature.name).push(id);
  }
}

// In health bar matching loop (line 686)
// Add check: if multiple instances of same name exist, use stricter distance threshold
const sameNameInstances = instancesInBattleList.get(oldCreature.name) || [];
const strictThreshold = sameNameInstances.length > 1 ? 50 : CORRELATION_DISTANCE_THRESHOLD_PIXELS;
if (distance < Math.min(minDistance, strictThreshold)) {
  // ... match
}
```

### HIGH: Add Position Confidence Scoring
**Problem**: Position jitter confirmation causes lag
**Solution**: Replace binary uncertain/certain with confidence score 0-100

### MEDIUM: Improve Name Matching
**Problem**: Similarity threshold 0.55 too permissive for similar names
**Solution**: Use context-aware thresholds (higher for similar names)

### LOW: Add Debugging Instrumentation
**Problem**: Hard to diagnose which assumption failed
**Solution**: Add detailed logging for each decision point (already partially done)

---

## CONCLUSION

The creatureMonitor makes **67 distinct assumptions** across 9 pipeline stages. The most fragile assumptions are:

1. **Health bar correlation by distance** (identity swaps)
2. **Battle list OCR accuracy** (affects all identification)
3. **Position calculation timing** (animation freeze + jitter confirmation)
4. **Reachability caching** (stale data)
5. **Name fuzzy matching** (similar creature types)

The bugs you're experiencing (wrong targeting, identity swaps, random retargeting) are **directly caused by assumption failures** in these areas, particularly #1 and #3 working together to create race conditions.
