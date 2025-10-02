# Targeting Methods: Tab / Grave / Mouse

## Overview

The targeting system intelligently chooses between three methods to acquire targets from the battle list:

1. **Tab Key** - Target next creature (forward)
2. **Grave Key** (`) - Target previous creature (backward)
3. **Mouse Click** - Direct click on battle list entry

## Method Selection Logic

### Priority Order

```javascript
1. Check if Tab can be used (currentIndex + 1 = desiredIndex)
2. Check if Grave can be used (currentIndex - 1 = desiredIndex)
3. Apply 15% random override to use mouse instead
4. Fall back to mouse for all other cases
```

### Decision Tree

```
Is desired target at currentIndex + 1?
├─ Yes → Can use Tab
│  └─ Roll 15% dice
│     ├─ 85% → Use Tab ✅
│     └─ 15% → Force mouse click 🖱️
│
└─ No → Check Grave
   Is desired target at currentIndex - 1?
   ├─ Yes → Can use Grave
   │  └─ Roll 15% dice
   │     ├─ 85% → Use Grave ✅
   │     └─ 15% → Force mouse click 🖱️
   │
   └─ No → Use mouse click 🖱️
```

## Use Cases

### 1. Tab Key (Next Target)

**When it's used:**
- Current target is at index `N`
- Desired target is at index `N+1`
- 85% probability (15% override to mouse)

**Special case:**
- No current target (index = -1)
- Desired target is first entry (index = 0)
- `0 === -1 + 1` ✅ → Use Tab

**Example:**
```
Battle List:
  0: Rat         ← No target
  1: Dragon      ← Want to target this
  2: Demon

Current: None (-1)
Desired: Dragon (1)
Check: 1 === -1 + 1? NO! (1 ≠ 0)
Result: Use mouse ❌

Battle List:
  0: Rat         ← Want to target this
  1: Dragon
  2: Demon

Current: None (-1)
Desired: Rat (0)
Check: 0 === -1 + 1? YES! (0 === 0)
Result: Use Tab ✅
```

### 2. Grave Key (Previous Target)

**When it's used:**
- Current target exists (not -1)
- Current target is at index `N`
- Desired target is at index `N-1`
- 85% probability (15% override to mouse)

**Special case:**
- Cannot use Grave if no current target
- Grave does nothing when no target is selected

**Example:**
```
Battle List:
  0: Rat
  1: Dragon      ← Currently targeted
  2: Demon       ← Want to target this

Current: Dragon (1)
Desired: Demon (2)
Check: 2 === 1 - 1? NO! (2 ≠ 0)
Result: Use mouse ❌

Battle List:
  0: Rat         ← Want to target this
  1: Dragon      ← Currently targeted
  2: Demon

Current: Dragon (1)
Desired: Rat (0)
Check: 0 === 1 - 1? YES! (0 === 0)
Result: Use Grave ✅
```

### 3. Mouse Click (Fallback)

**When it's used:**
- Desired target is not adjacent to current target
- 15% random override when Tab/Grave would work
- Always used for large jumps in battle list

**Example:**
```
Battle List:
  0: Rat         ← Currently targeted
  1: Dragon
  2: Demon       ← Want to target this

Current: Rat (0)
Desired: Demon (2)
Check Tab: 2 === 0 + 1? NO (2 ≠ 1)
Check Grave: N/A (would be -1)
Result: Use mouse ✅
```

## 15% Mouse Override

### Purpose
Adds unpredictability to targeting behavior. Real players don't always use Tab/Grave even when it would be optimal.

### Implementation
```javascript
const forceMouseClick = Math.random() < 0.15;

if (canUseTab && !forceMouseClick) {
  method = 'tab';
} else if (canUseGrave && !forceMouseClick) {
  method = 'grave';
} else {
  method = 'mouse';
}
```

### Statistics (100 targets)

**When Tab/Grave is available:**
```
85 uses → Tab/Grave key (85%)
15 uses → Mouse click (15% override)
```

**When neither is available:**
```
100 uses → Mouse click (100%)
```

## Code Structure

### Function Signature
```javascript
export function acquireTarget(
  sabStateManager,
  parentPort,
  targetName,
  lastClickedIndex
)
```

### Return Value
```javascript
{
  success: boolean,
  clickedIndex: number,
  method: 'tab' | 'grave' | 'mouse',
  reason?: string // Only present on failure
}
```

### Method Detection
```javascript
// Find indices
const desiredTargetIndex = battleList.indexOf(desiredTargetEntry);
const currentTargetIndex = battleList.findIndex(entry => entry.isTarget);

// Check adjacency
const canUseTab = desiredTargetIndex === currentTargetIndex + 1;
const canUseGrave = currentTargetIndex !== -1 && 
                    desiredTargetIndex === currentTargetIndex - 1;

// Apply randomization
const forceMouseClick = Math.random() < 0.15;
```

## Examples

### Example 1: Sequential Targeting (Tab)

```
Initial state: No target

Target "Rat" (index 0):
  currentIndex: -1
  desiredIndex: 0
  canUseTab: 0 === -1 + 1 ✅
  method: Tab (85%) or Mouse (15%)

After Tab → Rat is targeted

Target "Dragon" (index 1):
  currentIndex: 0
  desiredIndex: 1
  canUseTab: 1 === 0 + 1 ✅
  method: Tab (85%) or Mouse (15%)

After Tab → Dragon is targeted

Target "Demon" (index 2):
  currentIndex: 1
  desiredIndex: 2
  canUseTab: 2 === 1 + 1 ✅
  method: Tab (85%) or Mouse (15%)
```

### Example 2: Reverse Targeting (Grave)

```
Initial state: Demon targeted (index 2)

Target "Dragon" (index 1):
  currentIndex: 2
  desiredIndex: 1
  canUseGrave: 1 === 2 - 1 ✅
  method: Grave (85%) or Mouse (15%)

After Grave → Dragon is targeted

Target "Rat" (index 0):
  currentIndex: 1
  desiredIndex: 0
  canUseGrave: 0 === 1 - 1 ✅
  method: Grave (85%) or Mouse (15%)
```

### Example 3: Jump Targeting (Mouse)

```
Initial state: Rat targeted (index 0)

Target "Demon" (index 2):
  currentIndex: 0
  desiredIndex: 2
  canUseTab: 2 === 0 + 1? NO (2 ≠ 1)
  canUseGrave: 2 === 0 - 1? NO (2 ≠ -1)
  method: Mouse (100%)
```

### Example 4: First Target (Edge Case)

```
Initial state: No target

Target "Dragon" (index 1):
  currentIndex: -1
  desiredIndex: 1
  canUseTab: 1 === -1 + 1? NO (1 ≠ 0)
  canUseGrave: N/A (no current target)
  method: Mouse (100%)
```

## Benefits

### 1. Natural Behavior ✅
- Mimics real player targeting patterns
- Uses keyboard shortcuts when appropriate
- Occasional mouse clicks add variety

### 2. Performance ✅
- Tab/Grave are instant (no cursor movement)
- Reduces input queue load
- Faster targeting response

### 3. Detection Resistance ✅
- 15% randomization breaks patterns
- Mix of keyboard and mouse input
- Unpredictable targeting method

### 4. Efficiency ✅
- Prefers fast keyboard shortcuts
- Falls back to mouse when needed
- No wasted clicks on wrong targets

## Testing

### Test Cases

**Test 1: First target, no selection**
```javascript
battleList = [{name: 'Rat', isTarget: false}, {name: 'Dragon', isTarget: false}];
targetName = 'Rat';
// Expected: Tab (85%) or Mouse (15%)
```

**Test 2: Next target (Tab)**
```javascript
battleList = [{name: 'Rat', isTarget: true}, {name: 'Dragon', isTarget: false}];
targetName = 'Dragon';
// Expected: Tab (85%) or Mouse (15%)
```

**Test 3: Previous target (Grave)**
```javascript
battleList = [{name: 'Rat', isTarget: false}, {name: 'Dragon', isTarget: true}];
targetName = 'Rat';
// Expected: Grave (85%) or Mouse (15%)
```

**Test 4: Jump (Mouse)**
```javascript
battleList = [{name: 'Rat', isTarget: true}, {name: 'Dragon', isTarget: false}, {name: 'Demon', isTarget: false}];
targetName = 'Demon';
// Expected: Mouse (100%)
```

## Debugging

### Log Method Usage
```javascript
// Add after method selection
console.log(`Targeting method: ${method}`, {
  currentIndex: currentTargetIndex,
  desiredIndex: desiredTargetIndex,
  canUseTab,
  canUseGrave,
  forceMouseClick
});
```

### Expected Output
```
Targeting method: tab { currentIndex: 0, desiredIndex: 1, canUseTab: true, ... }
Targeting method: grave { currentIndex: 2, desiredIndex: 1, canUseGrave: true, ... }
Targeting method: mouse { currentIndex: 0, desiredIndex: 3, canUseTab: false, ... }
```

## Edge Cases

### Edge Case 1: Empty Battle List
```javascript
if (battleList.length === 0) {
  return { success: false, reason: 'battlelist_empty' };
}
```

### Edge Case 2: Target Not in List
```javascript
if (!desiredTargetEntry) {
  return { success: false, reason: 'not_in_battlelist' };
}
```

### Edge Case 3: Grave with No Target
```javascript
const canUseGrave = currentTargetIndex !== -1 && 
                    desiredTargetIndex === currentTargetIndex - 1;
// Grave requires existing target!
```

## Statistics

### Method Distribution (1000 targets)

**Scenario A: Sequential targeting (all next/prev)**
```
850 uses → Tab/Grave (85%)
150 uses → Mouse override (15%)
```

**Scenario B: Random targeting (50% adjacent, 50% jump)**
```
425 uses → Tab/Grave (42.5%)
 75 uses → Mouse override (7.5%)
500 uses → Mouse (jumps) (50%)
━━━━━━━━━━━━━━━━━━━━
1000 uses total
```

**Scenario C: Real-world targeting (estimated)**
```
~600 uses → Tab/Grave (60%)
~100 uses → Mouse override (10%)
~300 uses → Mouse (jumps) (30%)
```

## Comparison

| Method | Speed | Natural | Pattern Risk | Use Case |
|--------|-------|---------|--------------|----------|
| Tab | ⚡ Instant | ✅ Very | Low | Next target |
| Grave | ⚡ Instant | ✅ Very | Low | Previous target |
| Mouse | 🐢 ~200ms | ✅ Good | Very Low | Any target |

---

**Status**: ✅ IMPLEMENTED  
**Date**: 2025-10-02  
**File**: `electron/workers/targeting/targetingLogic.js`  
**Function**: `acquireTarget()`  
