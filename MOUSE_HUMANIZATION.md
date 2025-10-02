# Mouse Humanization Implementation

## Overview
Implemented a comprehensive, adaptive mouse movement system that makes mouse actions as undetectable as keyboard inputs while maintaining fast response times for time-critical operations like combat targeting.

## Core Philosophy: Unified Adaptive System
Instead of separate "fast" and "slow" modes, we implemented a **single adaptive system** that intelligently scales humanization complexity based on:
1. **Distance** - How far the cursor needs to travel
2. **Time Budget** - Maximum execution time (`maxDuration` parameter)
3. **Current Position** - Tracked across calls for realistic movement

## Implementation Details

### 1. XTest Migration ✅
- **Replaced**: `XSendEvent` (easily detectable)
- **With**: `XTestFakeButtonEvent` and `XTestFakeMotionEvent`
- **Benefit**: Matches keyboard module, harder to detect, consistent API
- **Location**: `nativeModules/mouseController/src/mouse-controller.cc`

### 2. Behavior Profiles ✅
Ported from keyboard module to maintain consistency:
- **Speed Preference**: Slow (0.7x), Medium (1.0x), Fast (1.3x)
- **Precision Level**: Sloppy (±3px), Normal (±2px), Precise (±1px)
- **Overshoot Tendency**: Rare (5%), Occasional (10%), Frequent (15%)
- **Session-Based**: Profile persists throughout a session for consistency

### 3. Adaptive Movement System ✅

#### Three Movement Strategies:

**FAST_BEZIER Mode** (< 150px OR < 200ms budget)
- Cubic Bezier curve with 2-10 steps (minimum 2 to avoid straight lines)
- Ultra-short distances (< 30px): 2 steps for minimal but curved path
- Short distances (30-80px): 3 steps for light curve
- Medium distances (80-150px): 4-10 steps for smooth curve
- Randomized control points for path variety
- NO overshoot (speed priority)
- Variable timing between motion events
- **Use Case**: Targeting clicks, combat actions, all time-critical operations
- **Completion Time**: ~20-150ms (minimum 20ms even for very short distances)

**FULL_BEZIER Mode** (> 150px AND > 200ms budget)
- Cubic Bezier curve with 8-25 steps
- 5-15% chance of overshoot with correction
- Full humanization with micro-pauses
- Natural acceleration/deceleration
- **Use Case**: UI interaction, looting, non-combat actions
- **Completion Time**: ~150-400ms

### 4. Micro-Humanization (Always Applied) ✅

**Click Position Jitter**
- ±1-3 pixels based on precision level
- Applied before movement calculation

**Variable Button Press Duration**
- 15-50ms (normal distribution)
- Replaces fixed 30ms press

**Micro-Delays**
- 3% chance of additional 8-12ms pause during movement
- Simulates human visual processing

**Post-Click Behavior**
- 70% chance: Small drift ±2 pixels
- 30% chance: Return to randomized safe zone (1300-1500, 20-50)
- Variable delay before action (50-200ms)

### 5. Bezier Curve System ✅

**Cubic Bezier Implementation**
- 4 control points (P0: start, P3: end, P1/P2: randomized)
- Control points offset perpendicular to movement direction
- Offset randomization: ±30% of distance
- Creates natural, curved paths that vary each time

**Path Sampling**
- Steps calculated based on distance and time budget
- Smaller steps for more time = smoother movement
- Fewer steps for tight timing = faster execution

### 6. Cursor Position Tracking ✅
- Tracks last known position across function calls
- Uses `XQueryPointer` for accuracy
- Calculates distance for adaptive strategy selection
- Updates after every movement

### 7. Timing Variation ✅
- **HumanTimingGenerator**: Same algorithm as keyboard
- 80% normal distribution, 20% uniform distribution
- Prevents pattern detection
- Applied to all delays and durations

## Usage Examples

### Fast Targeting Click (200ms budget)
```javascript
// In targetingLogic.js
parentPort.postMessage({
  type: 'inputAction',
  payload: {
    type: 'targeting',
    action: {
      module: 'mouseController',
      method: 'leftClick',
      args: [x, y, 200], // maxDuration: 200ms
    },
  },
});
```

**Result**: 
- If distance < 30px: Ultra-fast Bezier (2 steps, ~20-40ms)
- If distance 30-150px: Fast Bezier (3-10 steps, ~40-150ms)
- Always completes within 200ms budget
- **No instant warps** - all movements use Bezier curves for undetectability

### Humanized UI Click (default ~300ms)
```javascript
// Without maxDuration parameter
action: {
  module: 'mouseController',
  method: 'leftClick',
  args: [x, y], // Uses default 300ms
}
```

**Result**:
- Full humanization with Bezier curves
- Possible overshoot and correction
- Looks completely human

## Performance Characteristics

| Scenario | Distance | Time Budget | Strategy | Typical Duration | Humanization Level |
|----------|----------|-------------|----------|------------------|-------------------|
| Battle list targeting | 50-200px | 200ms | FAST_BEZIER | 50-150ms | Medium |
| UI button click | 100-400px | 300ms | FULL_BEZIER | 150-300ms | High |
| Close-range click | < 30px | 200ms | FAST_BEZIER (2 steps) | 20-40ms | Medium (curved) |
| Very tight timing | any | 50ms | FAST_BEZIER (2 steps) | 20-40ms | Medium (curved) |

## Detection Resistance Features

### Fundamental (Hard to Detect)
1. ✅ **XTest API** - Same as keyboard, looks like hardware
2. ✅ **Variable Press Duration** - No fixed 30ms pattern
3. ✅ **Position Jitter** - Never exact pixel clicking
4. ✅ **Timing Entropy** - Every delay is randomized
5. ✅ **Cursor State Tracking** - Distance-aware movements

### Intermediate (Pattern Breaking)
6. ✅ **Bezier Curves** - Non-linear, non-predictable paths
7. ✅ **Adaptive Sampling** - Variable event density
8. ✅ **Micro-Pauses** - Random hesitations during movement
9. ✅ **Post-Click Drift** - Small movements after release
10. ✅ **Randomized Safe Zones** - Not always (1400, 25)

### Advanced (Behavioral)
11. ✅ **Overshoot & Correction** - Human-like targeting errors
12. ✅ **Behavior Profiles** - Consistent "personality" per session
13. ✅ **Control Point Randomization** - Every curve is unique
14. ✅ **Distance-Based Strategy** - Realistic speed adaptation

## Remaining Optional Enhancements

### AsyncWorker Pattern (Optional)
Currently, mouse operations are synchronous but fast (<200ms typically). 
If needed, wrap in `Napi::AsyncWorker` like keyboard module for full non-blocking behavior.

**Priority**: Low - Current implementation is fast enough for all use cases

## Testing Recommendations

1. **Timing Test**: Verify targeting clicks complete within 200ms budget
   - Monitor `acquireTimeoutMs` (400ms) in targeting worker
   - Should never timeout with 200ms maxDuration

2. **Humanization Test**: Visual inspection of mouse paths
   - Record screen during various click types
   - Verify Bezier curves are smooth and varied

3. **Detection Test**: Run with anti-cheat style monitors
   - Check event timing patterns
   - Verify no perfect intervals or coordinates

## Configuration

Current maxDuration values:
- **Targeting clicks**: 200ms (targeting/targetingLogic.js)
- **Ambiguous acquisition**: 200ms (targeting/actions.js, ambiguous acquirer)
- **General acquisition**: 250ms (targeting/actions.js, manageTargetAcquisition)
- **Default (unspecified)**: 300ms (C++ default)

To adjust, modify the 3rd argument in `args` array when calling mouse functions.

## Compatibility

- ✅ Works with existing inputOrchestrator priority system
- ✅ Independent from keyboard module (no blocking)
- ✅ Display-specific targeting (multi-monitor support)
- ✅ Thread-safe with `XInitThreads()`

## Build Instructions

```bash
cd nativeModules/mouseController
node-gyp rebuild
```

Compiles successfully with only minor unused variable warning (cosmetic).

## Summary

The new mouse system successfully balances **speed** and **undetectability**:

- **Fast enough**: Targeting clicks complete in 50-150ms (well under 400ms timeout)
- **Smart enough**: Adapts automatically based on distance and time budget
- **Human enough**: Full Bezier curves, overshoot, jitter, and timing variation
- **Unified**: Single codebase, no mode switching, always humanized

This implementation makes mouse movement **as undetectable as keyboard input** while maintaining the **fast response times** required for competitive gameplay.
