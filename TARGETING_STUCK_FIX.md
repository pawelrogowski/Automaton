# Targeting Stuck Issue - Fixed

## Problem

After implementing Tab/Grave/Mouse targeting, the bot would get stuck and not target creatures even when they were in the battle list.

## Root Cause

The mouse click logic was broken. It was trying to find a target entry using:

```javascript
// WRONG - this would fail for multiple creatures or wrong index
const targetEntry = battleList.find(
  (entry, index) => entry.name === targetName && index === desiredTargetIndex
);
```

The issue:
1. **Lost cycling logic**: Removed the code that cycles through multiple creatures with the same name
2. **Wrong index logic**: Was trying to match `desiredTargetIndex` (from Tab/Grave logic) but that's not how mouse clicks work
3. **Missing lastClickedIndex**: The mouse fallback needs to track which entries it already tried

## Solution

Restored the proper mouse click logic that:
1. **Finds all potential entries** with matching name
2. **Cycles through them** using `lastClickedIndex`
3. **Wraps around** when reaching the end

```javascript
// CORRECT - cycles through all entries with matching name
const potentialEntries = battleList
  .map((entry, index) => ({ ...entry, index }))
  .filter((entry) => entry.name === targetName);

// Find next entry after lastClickedIndex
let targetEntry = potentialEntries.find(
  (entry) => entry.index > lastClickedIndex
);

// Wrap around if needed
if (!targetEntry) {
  targetEntry = potentialEntries[0];
}
```

## Why This Matters

### Scenario: Multiple Same-Named Creatures

```
Battle List:
  0: Rat
  1: Dragon
  2: Rat    ← Want to target this one
  3: Demon

Without fix:
- desiredTargetIndex = 2 (second Rat)
- Tries to find entry where name='Rat' AND index=2
- May fail if it finds first Rat instead
- Result: Stuck! ❌

With fix:
- Gets all Rats: [{index:0}, {index:2}]
- lastClickedIndex was -1 or 0
- Finds entry with index > lastClickedIndex
- Gets index 2 correctly
- Result: Works! ✅
```

## Code Flow

### Full acquireTarget Logic

```javascript
1. Get battle list and find desired creature
2. Calculate current and desired target indices
3. Check if Tab/Grave can be used:
   - Tab: desiredIndex === currentIndex + 1
   - Grave: desiredIndex === currentIndex - 1
4. Apply 15% random override
5. If Tab/Grave selected:
   → Send keyboard input
6. If Mouse selected:
   → Find all entries with matching name
   → Cycle through using lastClickedIndex
   → Send mouse click
```

## Testing

Before fix:
```
Battle List: [Rat, Rat, Dragon]
Target: Rat (any)
Result: Stuck ❌
```

After fix:
```
Battle List: [Rat, Rat, Dragon]
Target: Rat (any)
Attempt 1: Clicks first Rat ✅
Attempt 2: Clicks second Rat ✅
Attempt 3: Wraps to first Rat ✅
```

## Changes Made

**File:** `electron/workers/targeting/targetingLogic.js`

**Lines:** 185-225

**Change:** Restored proper mouse click cycling logic with `lastClickedIndex` tracking.

---

**Status**: ✅ FIXED  
**Date**: 2025-10-02  
**Issue**: Bot stuck, not targeting creatures  
**Cause**: Broken mouse click logic (wrong index matching)  
**Solution**: Restored cycling through entries with lastClickedIndex  
