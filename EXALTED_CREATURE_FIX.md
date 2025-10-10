# Exalted Creature Targeting Fix

## Problem Description

The bot was **ignoring exalted creatures** and not targeting them, even though they were properly configured in the targeting list. This issue occurred specifically when creatures became exalted, which caused their names to be truncated in the battle list due to the status icon taking up space.

### Example Scenario

- Normal creature: "Emerald Damselfly" - fits perfectly in battle list
- Exalted creature: "Emerald Damsel..." - truncated with "..." due to exalted icon

The bot would detect the creature, read its full name from the nameplate, but then **incorrectly remove it from the active creatures list**, thinking it had died or despawned.

## Root Cause Analysis

### The Flow

1. **Battle List OCR** (line 342-359 in `creatureMonitor.js`)
   - Reads: "Emerald Damsel..." (truncated)
   - Stores in battle list entries

2. **Nameplate OCR** (line 849-861)
   - Scans creature nameplate above health bar
   - Reads full name: "Emerald Damselfly"
   - Uses `findBestNameMatch()` to match against targeting list
   - Creature is correctly named "Emerald Damselfly" ✓

3. **Targeting Rule Matching** (line 106-107 in `targetingLogic.js`)
   - Looks for rule: "Emerald Damselfly"
   - Finds matching rule in targeting list ✓
   - Creature is selected as valid target ✓

4. **Battle List Validation** (line 1003-1031 in `creatureMonitor.js`) - **THE BUG**
   ```js
   // BROKEN CODE (before fix):
   const stillInBattleList = currentBattleListNames.get(creature.name) > 0;
   ```
   - Creature name: "Emerald Damselfly"
   - Battle list has: "Emerald Damsel..."
   - `currentBattleListNames.get("Emerald Damselfly")` returns `undefined`
   - `undefined > 0` is `false`
   - **Creature incorrectly removed as "not in battle list"!** ✗

### Why This Happened

The code had two places that checked if a creature was still in the battle list:

1. **Removal check** (line 1003-1031): Removes creatures not in battle list
2. **Persistence check** (line 1033-1062): Keeps creatures that lost health bars

Both checks used **exact name matching** via `Map.get()`, which failed for truncated names. The `acquireTarget()` function already had proper truncated name handling, but the creature monitoring didn't.

## The Fix

### 1. Added Helper Function

Created a reusable function to handle truncated name matching:

```js
/**
 * Checks if a creature name matches a battle list entry name.
 * Handles truncated names (e.g., "Emerald Damselfly" matches "Emerald Damsel...").
 * This is needed for exalted creatures where the status icon causes truncation.
 */
function isNameMatchingBattleList(creatureName, battleListName) {
  if (!creatureName || !battleListName) return false;
  
  // Exact match
  if (creatureName === battleListName) return true;
  
  // Truncated name match (e.g., "Emerald Damsel..." matches "Emerald Damselfly")
  if (battleListName.endsWith('...')) {
    const truncatedPart = battleListName.slice(0, -3);
    return creatureName.startsWith(truncatedPart);
  }
  
  return false;
}
```

### 2. Fixed Removal Logic

**File**: `electron/workers/creatureMonitor.js` (lines 1029-1048)

Before:
```js
const stillInBattleList = currentBattleListNames.get(creature.name) > 0;
```

After:
```js
let stillInBattleList = false;

for (const battleListName of currentBattleListNames.keys()) {
  if (isNameMatchingBattleList(creature.name, battleListName)) {
    stillInBattleList = true;
    break;
  }
}
```

Now it checks **all** battle list entries and properly handles truncated names.

### 3. Fixed Count-Based Persistence

**File**: `electron/workers/creatureMonitor.js` (lines 1050-1062)

Before:
```js
const battleListCountForName = currentBattleListNames.get(oldCreature.name) || 0;
```

After:
```js
let battleListCountForName = 0;

for (const [battleListName, count] of currentBattleListNames.entries()) {
  if (isNameMatchingBattleList(oldCreature.name, battleListName)) {
    battleListCountForName += count;
  }
}
```

Now it accumulates counts from all matching battle list entries (including truncated).

## How It Works Now

### Example: Exalted Emerald Damselfly

1. **Battle List**: "Emerald Damsel..." (truncated)
2. **Nameplate OCR**: "Emerald Damselfly" (full name)
3. **Battle List Validation**:
   - Checks: `isNameMatchingBattleList("Emerald Damselfly", "Emerald Damsel...")`
   - "Emerald Damsel...".endsWith('...') → true
   - Truncated part: "Emerald Damsel"
   - "Emerald Damselfly".startsWith("Emerald Damsel") → true
   - **Match found!** ✓
4. **Result**: Creature stays in active list and can be targeted!

### Edge Cases Handled

1. **Normal creatures**: Still work with exact matching
   - "Rotworm" === "Rotworm" ✓

2. **Long names that fit**: No truncation, exact match works
   - "Emerald Damselfly" === "Emerald Damselfly" ✓

3. **Long names truncated normally**: Handled by prefix match
   - "Troll Trained Salamander" matches "Troll Trained Sala..." ✓

4. **Exalted short names**: May not have "..." but still work
   - "Rotworm" === "Rotworm" ✓

5. **Multiple exalted creatures**: Count tracking works correctly
   - Two "Emerald Damsel..." → Two "Emerald Damselfly" counted ✓

## Benefits

1. **Exalted creatures now targetable**: Bot will properly target creatures with special status
2. **Consistent name handling**: Same truncation logic used everywhere
3. **No false removals**: Creatures won't be incorrectly removed from tracking
4. **Backward compatible**: Normal creatures still work exactly as before
5. **Reusable helper**: Can be used in other parts of the code if needed

## Testing Recommendations

1. **Test with exalted creatures**:
   - Wait for creatures to become exalted
   - Verify bot targets them correctly
   - Check creatures aren't removed prematurely

2. **Test with multiple exalted creatures**:
   - Multiple "Emerald Damsel..." in battle list
   - Verify correct count tracking
   - Ensure right creature is targeted

3. **Test with normal creatures**:
   - Verify normal targeting still works
   - Check non-truncated names work correctly

4. **Test name changes**:
   - Creature becomes exalted (name truncates)
   - Verify creature stays tracked
   - Check targeting continues working

## Technical Details

### Truncation Pattern

Battle list truncates names with "..." (three periods) when:
- Name is too long for available space
- Status icons (exalted, etc.) take up space
- Both factors combined

### Name Comparison Logic

The fix uses **prefix matching** for truncated names:
1. Check if battle list name ends with "..."
2. If yes, remove "..." to get prefix
3. Check if creature name starts with that prefix
4. Match found if prefix matches

### Performance Impact

Minimal - only adds one extra loop through battle list entries (typically < 10 entries).
The loop exits early on first match, so average case is very fast.

## Related Code

### Files Modified
- `electron/workers/creatureMonitor.js` - Core fix

### Related Functions
- `isNameMatchingBattleList()` - New helper function (line 132-145)
- Battle list removal check (line 1029-1048)
- Count-based persistence (line 1050-1062)

### Other Truncation Handling
- `acquireTarget()` in `targetingLogic.js` (line 192-201) - Already handled truncation
- Battle list validation in `creatureMonitor.js` (line 922-930) - Already handled truncation
- Target matching in `targetingWorker.js` (line 223) - Already handled truncation

---

**Status**: ✅ Fixed
**Date**: 2025-10-10
**Impact**: High - Enables targeting of exalted creatures
**Related Fix**: Works in conjunction with TARGETING_PATHING_MISMATCH_FIX.md
