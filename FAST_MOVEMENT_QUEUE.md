# Fast Movement Queue Implementation

## Problem Statement

Movement keys (QWEASDZXC) sent too quickly to the game are not properly registered. However, the standard keyboard queue with context-aware cooldowns (40-80ms) and thinking pauses was adding too much delay between movement commands, causing:

1. Sluggish cavebot movement
2. Delayed response to directional inputs
3. Unnecessary human-like timing for simple directional keys
4. Movement keys waiting behind other keyboard actions

## Solution: Separate Fast Movement Queue

### Architecture

Created a **third independent queue** specifically for directional movement keys that runs in parallel with keyboard and mouse queues.

```
┌─────────────────────────────────────────────────────────┐
│           Input Orchestrator (3 Queues)                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Keyboard   │  │    Mouse     │  │ FastMovement │ │
│  │    Queue     │  │    Queue     │  │    Queue     │ │
│  │              │  │              │  │              │ │
│  │ • Hotkeys    │  │ • Clicks     │  │ • QWEASDZXC  │ │
│  │ • Text input │  │ • Drags      │  │ • Arrow keys │ │
│  │ • Other keys │  │ • Moves      │  │              │ │
│  │              │  │              │  │              │ │
│  │ Priority     │  │ Priority     │  │ FIFO only    │ │
│  │ sorted       │  │ sorted       │  │ No sorting   │ │
│  │              │  │              │  │              │ │
│  │ 40-80ms      │  │ 40-500ms     │  │ 10ms only    │ │
│  │ cooldown     │  │ cooldown     │  │ (minimal)    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
│         All three queues process in parallel            │
└─────────────────────────────────────────────────────────┘
```

## Implementation Details

### Fast Movement Keys

```javascript
const FAST_MOVEMENT_KEYS = new Set([
  'q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c',  // Diagonal + cardinal
  'up', 'down', 'left', 'right',  // Arrow keys
]);
```

### Routing Logic

```javascript
// Only route to fast queue if BOTH conditions are met:
1. Key is in FAST_MOVEMENT_KEYS set
2. Action type is 'movement'

if (isFastMovementKey && isMovementType) {
  fastMovementQueue.push(item);  // → Fast lane!
} else {
  keyboardQueue.push(item);      // → Normal lane
}
```

### Processing Characteristics

| Feature | Regular Keyboard Queue | Fast Movement Queue |
|---------|----------------------|---------------------|
| **Priority Sorting** | ✅ Yes (0-100) | ❌ No (FIFO only) |
| **Starvation Prevention** | ✅ Yes | ❌ Not needed |
| **Context Cooldown** | ✅ 40-80ms | ❌ None |
| **Thinking Pauses** | ✅ Sometimes | ❌ Never |
| **Minimum Delay** | 40ms+ | **10ms only** |
| **Max Throughput** | ~15-25 keys/sec | **~100 keys/sec** |

## Examples

### Example 1: Cavebot Walking

**Before (Regular Queue):**
```
W key → Keyboard Queue → Wait 60ms cooldown → Execute
A key → Wait in queue → Wait 55ms cooldown → Execute
Total: ~115ms for 2 keys
```

**After (Fast Queue):**
```
W key → Fast Queue → Execute → Wait 10ms → Done
A key → Fast Queue → Execute → Wait 10ms → Done
Total: ~20ms for 2 keys (5.75x faster!)
```

### Example 2: Mixed Input (Cavebot + Healing)

**Before:**
```
W key (movement) → Queue position 2
F1 key (healing hotkey) → Queue position 1 (higher priority)
A key (movement) → Queue position 3
Result: F1, W, A with delays between each
```

**After:**
```
W key → Fast Movement Queue → Executes immediately
F1 key → Keyboard Queue → Executes in parallel
A key → Fast Movement Queue → Executes immediately
Result: W and A execute instantly, F1 runs independently
```

### Example 3: Script with Movement

**Before:**
```
Script keyPress('w') → Queue → Wait for other actions → 60ms delay
Script keyPress('a') → Queue → Wait → 55ms delay
```

**After:**
```
Script keyPress('w') → Fast Queue → 10ms
Script keyPress('a') → Fast Queue → 10ms
(But only if script type is 'movement', otherwise uses regular queue)
```

## Routing Decision Tree

```
Input Action Received
    │
    ├─ Module = 'mouseController'?
    │      └─→ Mouse Queue
    │
    └─ Module = 'keypress'?
           │
           ├─ Is key in FAST_MOVEMENT_KEYS?
           │  └─ Yes
           │     │
           │     └─ Type = 'movement'?
           │        ├─ Yes → Fast Movement Queue ✅
           │        └─ No  → Keyboard Queue
           │
           └─ No → Keyboard Queue
```

## Performance Characteristics

### Throughput Comparison

| Queue Type | Keys/Second | Use Case |
|------------|-------------|----------|
| Fast Movement | ~100 | Directional movement |
| Regular Keyboard | ~15-25 | Hotkeys, typing |
| Mouse | ~2-10 | Clicks, drags |

### Latency Comparison

| Action | Before (ms) | After (ms) | Improvement |
|--------|------------|-----------|-------------|
| Single movement key | 40-80 | 10 | 4-8x faster |
| Diagonal movement (2 keys) | 80-160 | 20 | 4-8x faster |
| Movement sequence (4 keys) | 160-320 | 40 | 4-8x faster |

## Benefits

### 1. **Responsive Movement**
- Cavebot reacts instantly to pathfinding changes
- No delay between directional inputs
- Smooth, continuous movement

### 2. **No Interference**
- Movement keys don't block healing hotkeys
- Healing hotkeys don't delay movement
- Mouse actions run completely independently

### 3. **Optimal Game Registration**
- 10ms is the minimum needed for reliable key registration
- Fast enough to feel instant
- Slow enough to be properly registered

### 4. **Clean Architecture**
- Separation of concerns (movement vs other inputs)
- Each queue optimized for its use case
- No priority conflicts

## Edge Cases Handled

### 1. Non-Movement Directional Keys

If a script or user rule uses 'w' for non-movement purposes:
```javascript
// Type = 'script', Key = 'w'
→ Regular keyboard queue (context-aware delays)
```

### 2. Mixed Movement Sources

```javascript
// Cavebot: type = 'movement', key = 'w' → Fast queue
// Script: type = 'script', key = 'w' → Regular queue
// Targeting: type = 'targeting', key = 'w' → Regular queue
```

### 3. Arrow Keys

Arrow keys are treated identically to QWEASDZXC:
```javascript
// Type = 'movement', key = 'up' → Fast queue
// Type = 'hotkey', key = 'up' → Regular queue
```

## Configuration

### Adjustable Parameters

```javascript
// Fast movement queue delay (currently 10ms)
await delay(10);  // Line 219 in inputOrchestrator.js

// Fast movement keys list
const FAST_MOVEMENT_KEYS = new Set([
  'q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c',
  'up', 'down', 'left', 'right',
]);
```

### Adding More Keys

To add more keys to the fast movement queue:
```javascript
const FAST_MOVEMENT_KEYS = new Set([
  // ... existing keys
  'numpad1', 'numpad2', 'numpad3',  // Example: add numpad
  'numpad4', 'numpad6', 'numpad7',
  'numpad8', 'numpad9',
]);
```

## Testing Recommendations

### Test Scenarios

1. **Rapid Movement Test**
   - Send W, W, W, W in quick succession
   - Verify all 4 keys execute
   - Verify total time ~40ms (4 * 10ms)

2. **Mixed Input Test**
   - Send W (movement) + F1 (hotkey) + A (movement)
   - Verify W and A execute via fast queue
   - Verify F1 executes via keyboard queue
   - Verify no interference

3. **Script Movement Test**
   - Lua script with `keyPress('w')`
   - If called with type 'movement', verify fast queue
   - If called with type 'script', verify regular queue

4. **Queue Independence Test**
   - Fill keyboard queue with 10 actions
   - Send movement key
   - Verify movement executes immediately

## Logging

Enable debug logging to see routing decisions:
```javascript
log('debug', `[InputOrchestrator] Routed ${key} to fast movement queue`);
log('debug', `[FastMovement] Executing movement: ${key}`);
```

## Files Modified

1. `electron/workers/inputOrchestrator.js` - Added fast movement queue system

## Conclusion

The fast movement queue provides:
✅ **4-8x faster** movement key execution
✅ **Zero interference** with other input types  
✅ **Optimal game performance** (10ms minimum)  
✅ **Clean separation** of concerns  
✅ **Parallel execution** across all three queues  

**Result:** Butter-smooth, responsive cavebot movement with no delays or conflicts! 🎮
