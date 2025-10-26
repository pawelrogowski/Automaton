# Creature Matching Pipeline Fix

**Date:** October 26, 2025  
**Issue:** Creature OCR matching "Rabbit" to "Bat" from targeting list  
**Status:** ✅ FIXED

## Problem Description

The creature monitor was incorrectly matching creatures by fuzzy-matching game world nameplate OCR against the **targeting list** instead of the **battle list**. This caused false matches:

### Bug Example:
- Battle list shows: `Rabbit` (complete, non-truncated name)
- Targeting list contains: `Bat`, `Rabbit`
- OCR reads from nameplate: `Rabbit`
- **Old behavior:** Fuzzy matches "Rabbit" against targeting list → finds "Bat" (similarity 0.333) → creates creature "Bat"
- **Result:** Wrong creature identity, targeting breaks

### Root Cause:
```javascript
// OLD CODE (lines 1058-1061)
const bestMatchName = detection.ocrName
  ? findBestNameMatch(detection.ocrName, canonicalTargetNames)  // ❌ Wrong!
  : null;
```

The code was matching nameplate OCR against `canonicalTargetNames` (union of targeting + battle list), allowing fuzzy matches even when the battle list contained the complete, exact name.

## Solution

Implemented a **battle list-first pipeline** with strict matching rules:

### New Pipeline (5 Steps):

1. **Battle List OCR** - Read and sanitize battle list, detect truncation (`...`)
2. **Match Battle List → Targeting List**
   - **Complete names:** EXACT match only (case-insensitive)
   - **Truncated names:** Fuzzy match allowed
   - Creates map: `{ battleListName → canonicalTargetingName }`
3. **Match Nameplates → Battle List**
   - OCR nameplates matched ONLY against battle list names
   - Never fuzzy match against targeting list
4. **Apply Canonical Names**
   - Use battle list → targeting mapping for canonical names
5. **Report Only Battle List Creatures**
   - Filter out any creatures not in battle list

### Key Changes:

#### 1. Detect Truncation in Battle List (`processBattleListOcr`)
```javascript
const wasTruncated = s.endsWith('...');
return {
  name: sanitized,
  isTruncated: wasTruncated,
  x: result.click.x,
  y: result.click.y,
};
```

#### 2. New Function: `matchBattleListToTargeting`
```javascript
function matchBattleListToTargeting(battleListEntries, targetingList) {
  const result = new Map();
  const explicitTargetNames = targetingList
    .filter((rule) => rule.name.toLowerCase() !== 'others')
    .map((rule) => rule.name);

  for (const entry of battleListEntries) {
    const blName = entry.name;
    const blLower = blName.toLowerCase();
    
    if (entry.isTruncated) {
      // Truncated: allow fuzzy matching
      const fuzzyMatch = findBestNameMatch(blName, explicitTargetNames, 0.3);
      if (fuzzyMatch) {
        result.set(blName, fuzzyMatch);
      } else {
        result.set(blName, blName);
      }
    } else {
      // Complete name: EXACT match only
      const exactMatch = explicitTargetNames.find(
        (target) => target && target.toLowerCase() === blLower
      );
      if (exactMatch) {
        result.set(blName, exactMatch);
      } else {
        result.set(blName, blName);
      }
    }
  }
  
  return result;
}
```

#### 3. Match Nameplates Against Battle List Only
```javascript
// CRITICAL: Match nameplate OCR against battle list names ONLY
let matchedBattleListName = null;

if (ocrName && ocrName.length > 0) {
  const ocrLower = ocrName.toLowerCase();
  
  // Try exact match first
  matchedBattleListName = allValidBattleListNames.find(
    (blName) => blName && blName.toLowerCase() === ocrLower
  );
  
  // If no exact match, try fuzzy matching against battle list only
  if (!matchedBattleListName) {
    matchedBattleListName = findBestNameMatch(ocrName, allValidBattleListNames, 0.3);
  }
}

// Get canonical name from battle list → targeting mapping
const canonicalName = matchedBattleListName 
  ? battleListToTargeting.get(matchedBattleListName) || matchedBattleListName
  : (lastSentTarget?.name || ocrName);
```

## Fixed Example Flow

### Scenario: "Rabbit" in battle list, "Bat" in targeting list

```
1. Battle List OCR:
   Input: Battle list UI shows "Rabbit"
   Output: { name: "Rabbit", isTruncated: false }

2. Match Battle List → Targeting:
   "Rabbit" is complete (not truncated)
   → Try EXACT match against targeting list
   → Found "Rabbit" in targeting list
   → Map: { "Rabbit" → "Rabbit" }

3. Nameplate OCR:
   Input: Game world nameplate shows "Rabbit"
   Output: ocrName = "Rabbit"

4. Match Nameplate → Battle List:
   "Rabbit" (exact, case-insensitive) matches "Rabbit" in battle list
   → matchedBattleListName = "Rabbit"

5. Get Canonical Name:
   battleListToTargeting.get("Rabbit") = "Rabbit"
   → canonicalName = "Rabbit"

6. Create Creature:
   ✓ Creature created with name "Rabbit"
   ✓ "Bat" is NEVER considered (not in battle list)
```

## Benefits

1. **Prevents False Matches:** "Rabbit" can never match "Bat" from targeting list
2. **Respects Battle List Authority:** Only creatures visible in battle list are detected
3. **Smart Truncation Handling:** Truncated names like "Emerald Damsel..." allow fuzzy matching
4. **Exact Matching for Complete Names:** Complete names require exact match, preventing typos
5. **Performance:** Pre-computed battle list → targeting mapping (no repeated fuzzy matching)

## Testing

Run test script to verify:
```bash
node test-creature-matching.js
```

Expected output:
- ✓ "Rabbit" matches "Rabbit" (exact)
- ✓ "Rabbit" does NOT match "Bat"
- ✓ Truncated names allow fuzzy matching
- ✓ Complete names require exact matching

## Files Modified

- `electron/workers/creatureMonitor.js` - Refactored detection pipeline
  - Lines 186-248: Enhanced `processBattleListOcr` with truncation detection
  - Lines 251-295: New `matchBattleListToTargeting` function
  - Lines 840-965: New pipeline implementation (battle list first)
  - Lines 1034-1068: Updated creature matching to use canonical names
  - Lines 1070-1131: Simplified creature creation
  - Lines 1177-1210: Updated filtering with truncation awareness

## Related Issues

- Similar to `LUA_API_PRIORITY_FIX.md` - both fixes ensure correct name/priority usage
- Addresses long-standing creature identity swap issues

## Migration Notes

- **No breaking changes** - existing targeting rules continue to work
- Battle list entries without targeting rules are kept as valid creatures
- Truncated battle list names continue to allow fuzzy matching as before
