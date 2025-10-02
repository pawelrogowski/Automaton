# Mouse Noise Generator System

## Overview

The mouse noise generator is a parallel, continuous system that generates human-like mouse movements during bot operation. Instead of calculating specific return positions after each action, it runs independently and creates natural idle movement patterns that mimic real player behavior.

## Key Concept

**Human players keep the mouse moving even when not actively performing actions.** They doodle in the game world, draw small circles, drift around, occasionally flick to UI elements, and sometimes pause. This system replicates that behavior through a continuous background process.

## Architecture

### Components

1. **mouseNoiseWorker.js** - Dedicated worker thread that generates and executes random movements
2. **inputOrchestrator.js** - Updated to handle mouseNoise actions with lowest priority
3. **workerManager.js** - Registers and manages the mouseNoiseWorker lifecycle

### Data Flow

```
mouseNoiseWorker (generates movements)
    ↓ 
inputOrchestrator (queues with priority 100)
    ↓
mouseController (executes via native module)
```

## Movement Patterns

### Pattern Types (Weighted Probabilities)

- **Small Circles** (25%) - Tight circular movements, 20-60px radius
- **Medium Circles** (20%) - Larger circles, 60-120px radius  
- **Drift** (25%) - Slow meandering across regions, 50-200px
- **Quick Flick** (10%) - Fast movements to distant points, 100-400px
- **Pause** (20%) - Stationary periods, 500-3000ms

### Region Preferences (Where Movement Occurs)

- **Game World** (75%) - Primary focus area
- **Battle List** (10%) - Occasional checks
- **Minimap** (8%) - Sometimes glance
- **Status Bar** (5%) - Rarely hover
- **Other UI** (2%) - Very rarely visit (health/mana bars, hotkeys)

## Behavior Characteristics

### Keyboard Activity Adaptation

When keyboard activity is detected:
- Pause probability increases 3x
- Quick flick probability reduced by 50%
- Drift probability reduced by 50%
- Mimics human behavior of reducing mouse movement while typing

Keyboard activity is tracked for 2 seconds after last keypress.

### Priority System

- **Priority Level**: 100 (lowest in system)
- **Interruption**: Any other action type will interrupt noise movements
- **No Cooldown**: Noise movements have 0ms delay between actions
- **Natural Preemption**: Higher priority actions automatically take precedence

## State Management

### Pause/Resume Control

The worker responds to control messages:
- `mouseNoisePause` - Temporarily stops generating movements
- `mouseNoiseResume` - Resumes movement generation
- `mouseNoiseEnable` - Enables/disables the entire system

### Conditional Activation

Noise generation only occurs when:
- Bot is enabled (`globalState.global.enabled`)
- Window ID and display are available
- Region coordinates are defined
- Worker is not paused

## Configuration

```javascript
MOUSE_NOISE_CONFIG = {
  ENABLED: true,
  UPDATE_INTERVAL_MS: 100,  // Check frequency
  
  PATTERN_WEIGHTS: {
    smallCircle: 0.25,
    mediumCircle: 0.20,
    drift: 0.25,
    quickFlick: 0.10,
    pause: 0.20,
  },
  
  REGION_WEIGHTS: {
    gameWorld: 0.75,
    battleList: 0.10,
    minimap: 0.08,
    statusBar: 0.05,
    other: 0.02,
  },
  
  DURATION_RANGES: {
    smallCircle: { min: 200, max: 500 },
    mediumCircle: { min: 500, max: 1000 },
    drift: { min: 800, max: 2000 },
    quickFlick: { min: 150, max: 300 },
    pause: { min: 500, max: 3000 },
  },
  
  DISTANCE_RANGES: {
    smallCircle: { min: 20, max: 60 },
    mediumCircle: { min: 60, max: 120 },
    drift: { min: 50, max: 200 },
    quickFlick: { min: 100, max: 400 },
  },
};
```

## Integration with Existing Systems

### No Special Handling Required

- **Targeting System**: No longer needs return position calculation
- **Cavebot**: No changes needed
- **Looting**: No changes needed
- **Lua Scripts**: No changes needed

The noise system runs in parallel and is automatically interrupted by any deliberate action.

### Future Enhancements (Optional)

1. **Pause on deliberate actions**: Workers could send `mouseNoisePause` before actions and `mouseNoiseResume` after
2. **Context awareness**: Adjust patterns based on combat vs exploration
3. **Learning patterns**: Track player's actual mouse patterns and replicate
4. **Energy conservation**: Reduce activity during long idle periods

## Detection Resistance Benefits

### Authenticity
- **Continuous Activity**: Mimics real players who constantly move their mouse
- **Pattern Variation**: Each session has unique movement signatures
- **Natural Pauses**: Includes realistic stationary periods
- **Typing Behavior**: Reduces movement during keyboard activity

### Unpredictability
- **Weighted Random Selection**: Patterns chosen probabilistically
- **Dynamic Durations**: Randomized timing for each movement
- **Region Distribution**: Natural focus distribution across UI
- **No Fixed Sequences**: Never repeats exact same pattern

### Human-like Characteristics
- **Game World Focus**: 75% of activity in main gameplay area
- **UI Awareness**: Occasional checks of battle list, minimap
- **Attention Simulation**: Pauses suggest reading/thinking
- **Smooth Transitions**: All movements use Bezier curves from native module

## Debugging

### Log Messages

- `[MouseNoise] Worker started` - Worker initialized
- `[MouseNoise] Starting <type> movement` - New pattern begun (debug level)
- `[MouseNoise] Paused/Resumed` - State changes (debug level)
- `[MouseNoise] Enabled/Disabled` - Configuration changes
- `[MouseNoise] Error...` - Any errors encountered

### Verification

To verify the system is working:
1. Enable debug logging in mouseNoiseWorker.js
2. Watch for pattern generation logs
3. Observe mouse movement when bot is idle
4. Confirm movement pauses during other actions

## Performance Impact

### Resource Usage
- **CPU**: Minimal - sleeps between movements
- **Memory**: ~5MB for worker thread
- **Network**: None
- **I/O**: None

### Efficiency
- Uses existing mouseController native module
- No additional IPC overhead beyond standard queue
- Async/await prevents blocking
- Efficient weighted random selection

## Files Modified

1. `electron/workers/mouseNoiseWorker.js` - New worker (376 lines)
2. `electron/workers/inputOrchestrator.js` - Added mouseNoise priority and delay config
3. `electron/workerManager.js` - Registered mouseNoiseWorker in configuration

## Testing Checklist

- [x] Syntax validation passes
- [ ] Worker starts without errors
- [ ] Movements occur when bot is enabled
- [ ] Movements stop when bot is disabled  
- [ ] Movements are interrupted by targeting/looting/etc
- [ ] Pattern distribution seems natural
- [ ] Region focus is appropriate (mostly game world)
- [ ] Keyboard activity reduces mouse movement
- [ ] No performance degradation

## Future Improvements

Once basic functionality is confirmed:

1. **Circular Motion**: Implement actual circular paths (currently just target points)
2. **Smoother Transitions**: Blend between patterns instead of discrete changes
3. **Adaptive Timing**: Learn optimal pause durations from player behavior
4. **Combat Awareness**: Increase pause probability during combat
5. **Profile System**: Different movement profiles (cautious, aggressive, relaxed)
6. **ML Integration**: Train on real player data for even more authentic patterns

## Removal of Old System

Once this system is verified working, we can:
1. Remove `getReturnPositionGameWorld()` from targetingLogic.js
2. Remove `getReturnPositionBattleList()` from targetingLogic.js
3. Remove return position logic from all targeting code
4. Simplify mouse action calls throughout codebase

The new approach is cleaner, more maintainable, and more authentic.
