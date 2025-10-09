# Mouse Noise Interference Fix

## Problem Description

After implementing the mouse noise generator, cavebot map clicks were occasionally being missed. The issue was a **race condition** between:

1. **Cavebot map clicks** - sending movement actions to click on the minimap
2. **Mouse noise movements** - continuously generating cursor movements every 200ms

Even though the priority system was working correctly (movement priority = 4, mouseNoise priority = 100), both actions could end up in the mouse queue simultaneously, causing interference.

## Root Cause

The mouse noise worker runs continuously and generates new cursor positions every 200ms, sending them as `inputAction` messages to the input orchestrator. When cavebot tried to send a map click at nearly the same time:

1. Mouse noise generates a new position and queues it
2. Cavebot sends a map click command
3. Even with higher priority, the timing could cause the noise movement to execute first or interfere
4. The map click gets delayed or missed entirely

**The key issue:** There was **no pause mechanism** implemented. The noise worker kept flooding the queue even during critical operations.

## Solution Implemented

Implemented the pause/resume mechanism that was mentioned in `MOUSE_NOISE_SYSTEM.md` (line 136) but never built:

### 1. Added Pause Logic to Input Orchestrator

**File:** `electron/workers/inputOrchestrator.js`

- Created `PAUSE_MOUSE_NOISE_FOR` set containing action types that should pause noise:
  - `userRule`
  - `looting`
  - `script`
  - `targeting`
  - `movement` (includes map clicks)
  - `hotkey`

- Added pause state tracking:

  ```javascript
  let mouseNoisePaused = false;
  let mouseNoiseResumeTimeout = null;
  ```

- **Before processing a critical mouse action:**
  - Check if it's a pause-worthy action
  - Send `pauseMouseNoise` message via parentPort
  - Set local pause flag

- **After processing a critical mouse action:**
  - Wait 300ms cooldown to ensure action completed
  - Check if more high-priority actions are queued
  - If queue is clear, send `resumeMouseNoise` message
  - Clear local pause flag

### 2. Added Message Forwarding in Worker Manager

**File:** `electron/workerManager.js`

- Added handlers to forward pause/resume messages from inputOrchestrator to mouseNoiseWorker:
  ```javascript
  if (message.type === 'pauseMouseNoise') {
    const mouseNoiseWorker = this.workers.get('mouseNoiseWorker');
    if (mouseNoiseWorker && mouseNoiseWorker.worker) {
      mouseNoiseWorker.worker.postMessage({ type: 'mouseNoisePause' });
    }
    return;
  }
  ```

### 3. Mouse Noise Worker Already Supports Pause

**File:** `electron/workers/mouseNoiseWorker.js`

The worker already had pause handling implemented (lines 338-347):

```javascript
if (message.type === 'mouseNoisePause') {
  isPaused = true;
  log('debug', '[MouseNoise] Paused');
  return;
}

if (message.type === 'mouseNoiseResume') {
  isPaused = false;
  log('debug', '[MouseNoise] Resumed');
  return;
}
```

When paused, the noise loop continues running but skips movement generation (line 251-254).

## How It Works Now

1. **Cavebot sends map click** → Input orchestrator receives it
2. **Orchestrator pauses mouse noise** → Sends message to worker manager
3. **Worker manager forwards pause** → Mouse noise worker stops generating movements
4. **Map click executes cleanly** → No interference from noise
5. **After 300ms cooldown** → Orchestrator checks if more actions are pending
6. **If queue is clear** → Resume message sent, noise continues

## Benefits

- **No more missed map clicks** - Mouse noise is paused during critical operations
- **Maintains human-like behavior** - Noise resumes after actions complete
- **Smart queue checking** - Only resumes if no more high-priority actions pending
- **Minimal overhead** - Uses existing message passing infrastructure

## Testing

To verify the fix is working:

1. Enable debug logging in `inputOrchestrator.js` (line 7: `debug: false`)
2. Enable debug logging in `mouseNoiseWorker.js` (line 7: `debug: false`)
3. Start cavebot with map clicking enabled
4. Watch for log messages:
   - `[InputOrchestrator] Paused mouse noise for critical action`
   - `[MouseNoise] Paused`
   - `[MouseNoise] Resumed`
   - `[InputOrchestrator] Resumed mouse noise`

## Performance Impact

- **Minimal** - Only adds:
  - 1 Set lookup per mouse action
  - 1 boolean check per action
  - 2 messages per pause/resume cycle (only when needed)
- **No CPU overhead** - No polling or busy-waiting
- **No timing changes** - Cooldowns remain the same

## Future Improvements

Optional enhancements if needed:

1. **Adaptive resume delay** - Could adjust 300ms based on action type
2. **Burst detection** - Pause longer if many actions are queued
3. **Priority-based pause** - Only pause for certain priority levels
4. **Metrics tracking** - Log how often pausing occurs for tuning

## Files Modified

1. `electron/workers/inputOrchestrator.js` - Added pause/resume logic
2. `electron/workerManager.js` - Added message forwarding
3. `MOUSE_NOISE_FIX.md` - This documentation

## Conclusion

The mouse noise system now properly coordinates with other input actions, preventing interference while maintaining authentic human-like behavior. Map clicks should now execute reliably without being disrupted by background noise movements.
