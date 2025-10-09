# Targeting Debug Logging - 2025-10-08

## Overview

Added comprehensive logging to track target changes and creature instance ID stability. This will help identify why retargeting occurs.

---

## Log Messages Added

### Targeting Worker Logs

#### **1. [TARGET CHANGE] SELECTING**

```
[TARGET CHANGE] SELECTING → Dragon (ID: 123, distance: 5.2, adjacent: false)
```

**When:** Initial target selection (SELECTING state)
**Indicates:** Bot picked a new target from scratch
**Look for:** Instance ID and distance to understand why this creature was chosen

---

#### **2. [TARGET CHANGE] PREEMPT**

```
[TARGET CHANGE] PREEMPT → Dragon (ID: 456, Prio: 15) replaces Rat (ID: 123, Prio: 5)
```

**When:** Higher priority creature causes target switch during combat
**Indicates:** Preemption logic triggered (priority difference ≥ 2)
**Look for:** Priority difference - should be at least 2 to trigger

---

#### **3. [TARGET LOST] - Instance ID Mismatch**

```
[TARGET LOST] Troll (ID: 123) - Reason: instance ID mismatch (game ID: 456)
```

**When:** Creature monitor changed the instance ID of the same creature
**Indicates:** **THIS IS THE PROBLEM** - Same creature got new ID
**Look for:**

- Old ID vs new ID
- Check if creature name is the same (should be)
- This means creature tracking in creatureMonitor failed

---

#### **4. [TARGET LOST] - No In-Game Target**

```
[TARGET LOST] Troll (ID: 123) - Reason: no in-game target (game ID: N/A)
```

**When:** No creature is actually targeted in-game
**Indicates:** Lost target selection (creature moved away, became unreachable, etc.)
**Look for:** This is normal when creatures die or flee

---

#### **5. [TARGET LOST] - Not Found in Creatures List**

```
[TARGET LOST] Troll (ID: 123) - Reason: not found in creatures list
```

**When:** Creature disappeared from the creatures array
**Indicates:** Creature monitor removed it (died, left battle list, etc.)
**Look for:** Check corresponding [CREATURE REMOVED] log in creatureMonitor

---

### Creature Monitor Logs

#### **6. [CREATURE NEW]**

```
[CREATURE NEW] Troll created with ID 456
```

**When:** New health bar detected that doesn't match any existing creature
**Indicates:** Either truly new creature OR failed to match existing one
**Look for:**

- Does this happen immediately after a [CREATURE REMOVED]?
- Same creature name? → Instance ID recycling problem

---

#### **7. [CREATURE REJECT]**

```
[CREATURE REJECT] ID 123 "Troll" rejected match - OCR read "Trol" (not similar)
```

**When:** OCR read a name that's not similar enough to existing creature
**Indicates:**

- Fuzzy matching failed (names too different)
- OR OCR read wrong creature's name
  **Look for:**
- Is the OCR name actually similar? Maybe threshold too strict
- Different creature in same spot?

---

#### **8. [CREATURE REMOVED]**

```
[CREATURE REMOVED] ID 123 "Troll" - not in battle list (died/despawned)
```

**When:** Creature disappeared from battle list
**Indicates:** Creature died or left detection range
**Look for:** Is this followed by [CREATURE NEW] with same name? → Instance ID churn

---

## How to Debug

### Pattern 1: Instance ID Recycling (Most Common Issue)

**Log sequence:**

```
[CREATURE REMOVED] ID 123 "Troll" - not in battle list
[CREATURE NEW] Troll created with ID 456
[TARGET LOST] Troll (ID: 123) - Reason: instance ID mismatch (game ID: 456)
[TARGET CHANGE] SELECTING → Troll (ID: 456, distance: 2.1, adjacent: true)
```

**Problem:** Same creature, new ID
**Root cause:**

- Creature temporarily disappeared from battle list (OCR error)
- Got removed and recreated
- Grace period too short

**Solution:** Increase grace periods in creatureMonitor

---

### Pattern 2: OCR Name Mismatch

**Log sequence:**

```
[CREATURE REJECT] ID 123 "Troll" rejected match - OCR read "Dwarf" (not similar)
[CREATURE REMOVED] ID 123 "Troll" - not in battle list
[CREATURE NEW] Dwarf created with ID 456
[TARGET LOST] Troll (ID: 123) - Reason: not found in creatures list
[TARGET CHANGE] SELECTING → Dwarf (ID: 456, ...)
```

**Problem:** OCR read wrong name
**Root cause:** Creatures overlapping, OCR confusion
**Solution:** This is expected behavior (different creature moved into position)

---

### Pattern 3: Flicker Grace Period Expiry

**Log sequence:**

```
[Time: 0ms] Troll has health bar, ID 123
[Time: 50ms] Health bar lost, grace period starts
[Time: 260ms] Grace period expires (> 250ms)
[CREATURE REMOVED] ID 123 "Troll" - not in battle list
[Time: 270ms] Health bar re-detected
[CREATURE NEW] Troll created with ID 456
[TARGET LOST] Troll (ID: 123) - instance ID mismatch (game ID: 456)
```

**Problem:** Health bar detection gap > grace period
**Root cause:** Detection failure lasted too long
**Solution:** Increase CREATURE_FLICKER_GRACE_PERIOD_MS

---

### Pattern 4: Legitimate Target Switch

**Log sequence:**

```
[TARGET CHANGE] PREEMPT → Dragon (ID: 789, Prio: 15) replaces Rat (ID: 456, Prio: 5)
```

**Problem:** None - this is correct behavior
**Root cause:** High priority creature appeared
**Solution:** Adjust priority values if this is unwanted

---

## What to Look For in Console

### ✅ **Good Signs:**

```
[TARGET CHANGE] SELECTING → Troll (ID: 100, ...)
... (5 seconds of combat)
[CREATURE REMOVED] ID 100 "Troll" - not in battle list (died)
[TARGET CHANGE] SELECTING → Rat (ID: 101, ...)
```

**Target changed because Troll died. Correct!**

---

### ❌ **Bad Signs:**

```
[TARGET CHANGE] SELECTING → Troll (ID: 100, ...)
[TARGET LOST] Troll (ID: 100) - Reason: instance ID mismatch (game ID: 101)
[TARGET CHANGE] SELECTING → Troll (ID: 101, ...)
```

**Same creature name, different ID within 1 second. PROBLEM!**

---

```
[CREATURE NEW] Troll created with ID 100
[CREATURE REMOVED] ID 100 "Troll" - not in battle list
[CREATURE NEW] Troll created with ID 101
[CREATURE REMOVED] ID 101 "Troll" - not in battle list
[CREATURE NEW] Troll created with ID 102
```

**Rapid creation/deletion cycles. Grace period too short or battle list flickering!**

---

## Troubleshooting Steps

### Step 1: Check for Instance ID Churn

**Look for:**

- Same creature name getting different IDs rapidly
- Pattern: REMOVED → NEW → REMOVED → NEW

**If found:**

- Increase `CREATURE_FLICKER_GRACE_PERIOD_MS` (currently 250ms)
- Increase `STATIONARY_CREATURE_GRACE_PERIOD_MS` (currently 500ms)

---

### Step 2: Check OCR Rejections

**Look for:**

- `[CREATURE REJECT]` messages
- Are rejected names similar to original? (e.g., "Trol" vs "Troll")

**If found:**

- OCR fuzzy matching might be too strict
- Check `isSimilarName()` function logic

---

### Step 3: Check Preemption Logic

**Look for:**

- `[TARGET CHANGE] PREEMPT` messages
- Are priority differences expected?

**If too many preemptions:**

- Increase `PRIORITY_THRESHOLD` (currently 2)
- Adjust creature priorities in targeting list

---

### Step 4: Check Hysteresis

**Look for:**

- Frequent `[TARGET CHANGE]` between similar creatures
- Same priority creatures swapping

**If found:**

- Increase `SCORE_THRESHOLD` in targetingLogic.js (currently 10)

---

## Example Analysis Session

### Console Output:

```
[14:23:10.123] [TARGET CHANGE] SELECTING → Cave Rat (ID: 234, distance: 1.2, adjacent: true)
[14:23:10.500] [CREATURE REJECT] ID 234 "Cave Rat" rejected match - OCR read "Cave" (not similar)
[14:23:10.650] [CREATURE REMOVED] ID 234 "Cave Rat" - not in battle list (died/despawned)
[14:23:10.750] [CREATURE NEW] Cave Rat created with ID 235
[14:23:10.800] [TARGET LOST] Cave Rat (ID: 234) - Reason: instance ID mismatch (game ID: 235)
[14:23:10.850] [TARGET CHANGE] SELECTING → Cave Rat (ID: 235, distance: 1.1, adjacent: true)
```

### Analysis:

1. **0ms:** Target selected (Cave Rat ID 234)
2. **377ms:** OCR read "Cave" instead of "Cave Rat" - fuzzy match failed
3. **527ms:** Creature removed (not in battle list - probably OCR error)
4. **627ms:** Same creature re-detected with new ID 235
5. **677ms:** Targeting sees ID change (234→235), thinks it's different creature
6. **727ms:** Re-selects "new" creature (actually same one)

### Diagnosis:

**OCR truncation issue** - "Cave Rat" being read as "Cave"

### Solutions:

1. Improve fuzzy matching to accept "Cave" as similar to "Cave Rat"
2. Increase grace period so OCR has more time to recover
3. Add whitelist for known truncations

---

## Disable Logging

If logs are too verbose, edit these lines:

**Targeting Worker:**

```javascript
// Line 18
const logger = createLogger({ info: false, error: true, debug: false });
//                                                            ^^^^^ change to false
```

**Creature Monitor:**

```javascript
// Line 31
const logger = createLogger({ info: false, error: true, debug: false });
//                            ^^^^^ change info to false
```

---

## Summary

With these logs, you can now:

- ✅ Track every target change with reason
- ✅ See creature instance ID lifecycle
- ✅ Identify OCR issues causing rejections
- ✅ Diagnose grace period problems
- ✅ Verify preemption logic working correctly

**Watch for:** `[TARGET LOST]` with reason "instance ID mismatch" - this indicates the creature monitor is creating new IDs for existing creatures.

---

**Date:** 2025-10-08  
**Status:** ✅ Implemented  
**Build:** ✅ Successful
