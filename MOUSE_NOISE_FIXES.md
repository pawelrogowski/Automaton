# Mouse Noise Worker Fixes

## Issues Identified

### 1. Incorrect Argument Format
**Problem**: The mouseNoiseWorker was sending arguments in the wrong format to inputOrchestrator.

**Original**:
```javascript
args: [windowId, x, y, display, duration]
```

**Fixed**:
```javascript
args: [x, y, duration]
```

**Reason**: The inputOrchestrator automatically prepends `windowId` and `display` when processing mouse actions. It expects:
- `args[0]` = x coordinate
- `args[1]` = y coordinate  
- `args[2]` = maxDuration (optional)
- `args[3]` = returnPosition (optional)

### 2. Missing Debug Logging
**Problem**: No visibility into whether the worker was running or generating movements.

**Fixed**: Enabled all logging levels:
```javascript
const log = createLogger({
  info: true,   // Was: false
  error: true,
  debug: true,  // Was: false
});
```

## How InputOrchestrator Processes Mouse Actions

```javascript
// inputOrchestrator.js line ~248-264
const mouseArgs = action.args || [];
const maxDuration = mouseArgs[2];        // Third arg
const returnPosition = mouseArgs[3];     // Fourth arg

const params = [windowId, mouseArgs[0], mouseArgs[1], display];
if (maxDuration !== undefined) {
  params.push(maxDuration);
}
if (returnPosition !== undefined) {
  if (maxDuration === undefined) {
    params.push(300);  // Default duration
  }
  params.push(returnPosition);
}

await mouseController[action.method](...params);
```

## Expected Behavior After Fix

With debug logging enabled, you should see:

1. **Startup**:
   ```
   [MouseNoise] Worker started
   [MouseNoise] Initialized and listening for messages
   ```

2. **During Operation** (when bot is enabled):
   ```
   [MouseNoise] Starting <pattern> movement
   [MouseNoise] Moving to (x, y) over Nms
   ```

3. **Pattern Distribution**:
   - Small circles (25%)
   - Medium circles (20%)
   - Drift (25%)
   - Quick flicks (10%)
   - Pauses (20%)

4. **Region Focus**:
   - 75% game world
   - 10% battle list
   - 8% minimap
   - 5% status bar
   - 2% other UI

## Troubleshooting Checklist

If mouse noise still doesn't work:

### Check Worker Started
```bash
# In terminal output, look for:
[MouseNoise] Worker started
[MouseNoise] Initialized and listening for messages
```

### Check Bot Enabled
The noise worker only generates movements when:
- `globalState.global.enabled === true`
- `globalState.global.windowId` is set
- `globalState.global.display` is set
- `globalState.regionCoordinates.regions` exists

### Check InputOrchestrator
```bash
# Should see in logs:
[Mouse] Executing mouseNoise: mouseMove
```

### Check Priority System
- mouseNoise has priority 100 (lowest)
- Any other action will interrupt it
- This is **expected behavior**

### Common Issues

1. **Worker Not Starting**:
   - Check workerManager.js registered mouseNoiseWorker
   - Check DEFAULT_WORKER_CONFIG.mouseNoiseWorker = true

2. **No Movements Generated**:
   - Check bot is enabled
   - Check regions are detected
   - Enable debug logging

3. **Movements Stop Immediately**:
   - Check if other actions are constantly queued
   - This is normal if bot is very active (targeting/looting)

4. **Mouse Doesn't Move**:
   - Check mouseController native module loaded
   - Check X11 display connection
   - Check window ID is valid

## Verification Commands

### Enable Just Mouse Noise
Temporarily disable other workers to verify noise works:
```javascript
// In workerManager.js DEFAULT_WORKER_CONFIG
{
  captureWorker: true,
  regionMonitor: true,
  screenMonitor: false,    // Disable
  minimapMonitor: false,   // Disable
  ocrWorker: false,        // Disable
  creatureMonitor: false,  // Disable
  cavebotWorker: false,    // Disable
  targetingWorker: false,  // Disable
  pathfinderWorker: false, // Disable
  windowTitleMonitor: false, // Disable
  inputOrchestrator: true,
  mouseNoiseWorker: true,  // Keep enabled
  enableLuaScriptWorkers: false,
}
```

### Test Pattern Generation
Add temporary logging to see pattern selection:
```javascript
// In mouseNoiseWorker.js generateMovement()
const pattern = weightedChoice(patterns);
console.log('[MouseNoise] Selected pattern:', pattern);
```

## Performance Notes

- Worker runs in separate thread - no main process impact
- Uses ~50ms between movements + pattern duration
- Automatically paused when bot disabled
- Minimal CPU usage (mostly sleeping)

## Next Steps

1. **Test with current fixes**
2. **Watch console logs** for movement messages
3. **Verify mouse actually moves** in game world
4. **Check it pauses during targeting/looting**
5. **Adjust timings** if movements feel too fast/slow

## Disabling Debug Logs

Once verified working, disable debug logs:
```javascript
const log = createLogger({
  info: false,
  error: true,
  debug: false,
});
```

This reduces console spam while keeping error reporting.
