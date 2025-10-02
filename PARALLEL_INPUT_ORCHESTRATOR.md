# Parallel Input Orchestrator

## Overview

The Input Orchestrator has been upgraded to support **parallel execution** of keyboard and mouse actions with **randomized cooldowns** (50-125ms).

## Key Changes

### 1. Separate Queues

**Before** (Sequential):
```javascript
const eventQueue = []; // Single queue for everything
let isProcessing = false;
```

**After** (Parallel):
```javascript
const keyboardQueue = []; // Keyboard actions only
const mouseQueue = [];    // Mouse actions only
let isProcessingKeyboard = false;
let isProcessingMouse = false;
```

### 2. Randomized Cooldowns

**Before** (Fixed):
```javascript
const delayMs = getRandomDelay(type); // 50-200ms based on type
await delay(delayMs);
```

**After** (Randomized):
```javascript
function getRandomCooldown() {
  return 50 + Math.floor(Math.random() * 76); // 50-125ms
}

await delay(getRandomCooldown());
```

### 3. Independent Processing

Keyboard and mouse actions now execute in parallel without blocking each other.

## Architecture

### Queue Routing

```javascript
if (payload.action.module === 'keypress') {
  keyboardQueue.push(item);
  processKeyboardQueue(); // Start keyboard processor
} else if (payload.action.module === 'mouseController') {
  mouseQueue.push(item);
  processMouseQueue(); // Start mouse processor
}
```

### Parallel Execution

```
Time →
─────────────────────────────────────────────────────

Keyboard Queue:
  Tab ▓▓░░ Grave ▓▓░░ W ▓▓░░ S ▓▓░░
  ↑ 82ms  ↑ 105ms  ↑ 67ms  ↑ 93ms

Mouse Queue:
     Click ▓▓▓▓▓▓▓░░░░ Move ▓▓▓░░ Click ▓▓▓▓▓░░
     ↑ 200ms + 114ms    ↑ 89ms  ↑ 200ms + 78ms

Legend:
▓ = Executing action
░ = Cooldown period
```

**No blocking!** Keyboard can execute while mouse is moving.

## Benefits

### 1. True Parallelism ✅

**Before:**
```
Tab press → Wait 50ms → Mouse click → Wait 200ms → Key W → Wait 50ms
Total: 300ms
```

**After:**
```
Tab press → Wait 50ms → Key W → Wait 50ms
     ↓ (parallel)
Mouse click → Wait 200ms
Total: ~200ms (40% faster!)
```

### 2. No Cross-Blocking ✅

- Keyboard actions don't wait for mouse movements
- Mouse movements don't block key presses
- Cavebot can walk while targeting (mouse click)
- Healing hotkeys work during mouse actions

### 3. Natural Timing ✅

**Randomized cooldowns** (50-125ms):
```
Action 1 → 67ms cooldown
Action 2 → 112ms cooldown
Action 3 → 89ms cooldown
Action 4 → 54ms cooldown
```

**No fixed patterns!**

### 4. Preserved Priority System ✅

Each queue maintains its own priority sorting:
- userRule: 0 (highest)
- looting: 1
- script: 2
- targeting: 3
- movement: 4
- hotkey: 5
- default: 10 (lowest)

## Execution Flow

### Example: Targeting + Walking

```javascript
1. Click battle list (mouse)
   → mouseQueue.push({...})
   → processMouseQueue() starts
   
2. Press Tab (keyboard) - happens 50ms later
   → keyboardQueue.push({...})
   → processKeyboardQueue() starts
   
3. Press W to walk (keyboard) - 100ms later
   → keyboardQueue.push({...})
   → Already processing, will execute after Tab
```

**Timeline:**
```
0ms:   Mouse click starts (200ms duration)
50ms:  Tab press (instant, 87ms cooldown)
137ms: W press (instant, 102ms cooldown)
200ms: Mouse click completes (114ms cooldown)
239ms: Both queues idle
```

## Code Structure

### Keyboard Processor

```javascript
async function processKeyboardQueue() {
  if (isProcessingKeyboard || keyboardQueue.length === 0) {
    isProcessingKeyboard = false;
    return;
  }

  isProcessingKeyboard = true;
  
  // Apply starvation prevention
  applyStarvationPrevention(keyboardQueue);
  
  // Sort by priority
  keyboardQueue.sort((a, b) => a.priority - b.priority);
  const item = keyboardQueue.shift();
  
  try {
    // Execute keyboard action
    await keypress[action.method](...args);
  } finally {
    // Random cooldown 50-125ms
    await delay(getRandomCooldown());
    isProcessingKeyboard = false;
    processKeyboardQueue(); // Process next
  }
}
```

### Mouse Processor

```javascript
async function processMouseQueue() {
  if (isProcessingMouse || mouseQueue.length === 0) {
    isProcessingMouse = false;
    return;
  }

  isProcessingMouse = true;
  
  // Apply starvation prevention
  applyStarvationPrevention(mouseQueue);
  
  // Sort by priority
  mouseQueue.sort((a, b) => a.priority - b.priority);
  const item = mouseQueue.shift();
  
  try {
    // Execute mouse action
    await mouseController[action.method](...params);
  } finally {
    // Random cooldown 50-125ms
    await delay(getRandomCooldown());
    isProcessingMouse = false;
    processMouseQueue(); // Process next
  }
}
```

## Starvation Prevention

Applied to **each queue independently**:

```javascript
function applyStarvationPrevention(queue) {
  const highestPriority = queue.reduce(
    (min, item) => Math.min(min, item.priority),
    Infinity
  );
  
  queue.forEach((item) => {
    if (item.priority > highestPriority && item.priority !== -1) {
      item.deferralCount++;
      if (item.deferralCount >= MAX_DEFERRALS) {
        item.priority = -1; // Boost to highest priority
      }
    }
  });
}
```

**MAX_DEFERRALS = 4**: After being skipped 4 times, priority is elevated to -1 (highest).

## Performance Analysis

### Cooldown Statistics

**Random range:** 50-125ms
**Average:** 87.5ms
**Distribution:** Uniform

```
50-62ms:  ██████████ 17%
63-75ms:  ██████████ 17%
76-87ms:  ██████████ 17%
88-100ms: ██████████ 17%
101-112ms: ██████████ 17%
113-125ms: ██████████ 15%
```

### Throughput Comparison

**Before (sequential, 50ms fixed):**
```
100 actions (50 keyboard + 50 mouse):
= 100 × 50ms = 5000ms = 5 seconds
```

**After (parallel, 50-125ms random):**
```
50 keyboard actions:
= 50 × 87.5ms (avg) = 4375ms

50 mouse actions (parallel):
= 50 × 87.5ms (avg) = 4375ms

Total: ~4.4 seconds (12% faster, but feels much smoother!)
```

### Real-World Impact

**Scenario: Targeting + Walking**

**Before:**
1. Click battle list: 200ms
2. Cooldown: 50ms
3. Tab press: instant
4. Cooldown: 50ms
5. Walk key: instant
6. Cooldown: 50ms
**Total: 350ms**

**After (parallel):**
1. Click battle list: 200ms (mouse queue)
2. Tab press: instant (keyboard queue, starts at 50ms) ✅
3. Walk key: instant (keyboard queue, starts at ~137ms) ✅
**Total: ~240ms (31% faster!)**

## Edge Cases

### 1. Empty Queue
```javascript
if (keyboardQueue.length === 0) {
  isProcessingKeyboard = false;
  return; // Stop processing
}
```

### 2. Missing Global State
```javascript
if (!globalState?.global?.windowId || !globalState?.global?.display) {
  isProcessingKeyboard = false;
  return; // Defer until state is available
}
```

### 3. Action Completion Tracking
```javascript
if (actionId !== undefined) {
  parentPort.postMessage({
    type: 'inputActionCompleted',
    payload: { actionId, success: true },
  });
}
```

## Testing

### Test Parallel Execution

```javascript
// Send keyboard and mouse actions simultaneously
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'targeting',
    action: { module: 'mouseController', method: 'leftClick', args: [100, 200] }
  }
});

parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'hotkey',
    action: { module: 'keypress', method: 'sendKey', args: ['f1', null] }
  }
});

// Expected: Both execute in parallel, no blocking
```

### Test Randomized Cooldowns

```javascript
// Collect cooldown times
const cooldowns = [];
for (let i = 0; i < 1000; i++) {
  cooldowns.push(getRandomCooldown());
}

// Verify range
const min = Math.min(...cooldowns); // Should be ~50
const max = Math.max(...cooldowns); // Should be ~125
const avg = cooldowns.reduce((a, b) => a + b) / cooldowns.length; // Should be ~87.5

console.log({ min, max, avg });
```

## Comparison

| Aspect | Before | After |
|--------|--------|-------|
| Queues | 1 (shared) | 2 (separate) |
| Execution | Sequential | Parallel |
| Cooldown | Fixed 50ms | Random 50-125ms |
| Blocking | ✅ Yes | ❌ No |
| Throughput | Lower | Higher |
| Natural timing | Moderate | High |
| Pattern detection | Moderate | Very low |

## Benefits Summary

1. ✅ **Parallel execution** - Keyboard and mouse don't block each other
2. ✅ **Randomized cooldowns** - No fixed timing patterns
3. ✅ **Better performance** - ~30% faster in real-world scenarios
4. ✅ **Natural behavior** - More human-like input timing
5. ✅ **No regressions** - Priority system and starvation prevention preserved

## Related Files

- `electron/workers/inputOrchestrator.js` - Main implementation
- `docs/inputOrchestrator.md` - Original documentation (needs update)

---

**Status**: ✅ IMPLEMENTED  
**Date**: 2025-10-02  
**Impact**: Parallel execution + randomized cooldowns  
**Performance**: ~30% faster, much smoother  
**Detection Risk**: Very low (randomized timing)
