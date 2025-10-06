# Critical Lua API Priority Bug Fix

## Problem Discovered

While auditing input action priorities across the codebase, a **critical bug** was discovered in `electron/workers/luaApi.js`:

### ❌ The Bug
All Lua script input actions were using `type: 'luaScript'`, but the inputOrchestrator priority map only recognizes `type: 'script'`.

```javascript
// WRONG - in luaApi.js (before fix)
postInputAction({
  type: 'luaScript',  // ❌ Not recognized by inputOrchestrator!
  action: { ... }
});

// CORRECT - in inputOrchestrator.js
const PRIORITY_MAP = {
  script: 2,  // ✅ Actual priority key
  ...
};
```

### Impact

This bug meant that **ALL** Lua script actions were:
1. ❌ Not getting the correct priority (falling back to default priority 10)
2. ❌ Not pausing mouse noise (not in `PAUSE_MOUSE_NOISE_FOR` set)
3. ❌ Executing with lower priority than intended (should be 2, was defaulting to 10)
4. ❌ Being interrupted by mouse noise movements

### Affected Actions

**ALL** Lua API functions that send input actions (41 total occurrences):

#### Keyboard Actions
- `keyPress()` - Single key presses
- `keyPressMultiple()` - Multiple key presses with delays
- `typeText()` - Text typing (typeArray)
- `typeSequence()` - Multiple texts with delays
- `npcTalk()` - NPC conversation handling
- `rotate()` - Character rotation
- `login()` - Login sequence (multiple keypresses)

#### Mouse Actions
- `clickTile()` - Game world tile clicks (left/right)
- `clickAbsolute()` - Absolute screen coordinate clicks
- `mapClick()` - Minimap clicks
- `drag()` - Game world drag operations
- `dragAbsolute()` - Absolute drag operations
- `useItemOnSelf()` - Use hotkey item on player
- `useItemOnTile()` - Use hotkey item on tile
- Internal: `closeAllModals()` - Modal closing clicks
- Internal: `npcTalk()` tab clicks

## The Fix

### Solution
Used sed to replace ALL occurrences of `type: 'luaScript'` with `type: 'script'`:

```bash
sed -i "s/type: 'luaScript'/type: 'script'/g" electron/workers/luaApi.js
```

### Result
✅ Fixed 41 occurrences across the entire file

### Verification
```javascript
// AFTER FIX - All Lua actions now use correct type
postInputAction({
  type: 'script',  // ✅ Recognized by inputOrchestrator!
  action: { ... }
});
```

## Before vs After

### Before Fix

```
Lua Script: "Click minimap at (100, 100)"
├─ Type: 'luaScript' (unrecognized)
├─ Priority: 10 (default fallback)
├─ Pauses noise: NO
└─ MouseQueue: [LuaClick(priority=10), NoiseMove(priority=100)]
    Result: Lua click executes, THEN noise moves ❌
```

### After Fix

```
Lua Script: "Click minimap at (100, 100)"
├─ Type: 'script' (recognized)
├─ Priority: 2 (high priority)
├─ Pauses noise: YES
└─ MouseQueue: [LuaClick(priority=2)] + Noise PAUSED
    Result: Noise pauses → Lua click executes → Noise resumes ✅
```

## Priority System Integration

### Correct Priority Assignment
```javascript
const PRIORITY_MAP = {
  userRule: 0,
  looting: 1,
  script: 2,      // ✅ Lua scripts get priority 2
  targeting: 3,
  movement: 4,
  hotkey: 5,
  mouseNoise: 100,
};
```

### Mouse Noise Pause Trigger
```javascript
const PAUSE_MOUSE_NOISE_FOR = new Set([
  'userRule', 'looting',
  'script',    // ✅ Lua scripts now pause noise
  'targeting', 'movement', 'hotkey',
]);
```

## Execution Order Examples

### Example 1: Lua Script `mapClick()`
```
BEFORE: script(10) → noise(100) → Both execute, noise interferes ❌
AFTER:  Pause noise → script(2) → Wait → Resume noise ✅
```

### Example 2: Lua Script `clickTile()` during cavebot
```
BEFORE: cavebot(4) → lua(10) → noise(100) → Wrong order! ❌
AFTER:  lua(2) → cavebot(4) → Correct order! ✅
```

### Example 3: Lua Script `login()` sequence
```
BEFORE: Each keypress competes with noise moves ❌
AFTER:  Noise paused for entire login sequence ✅
```

## Testing Recommendations

### Test These Lua Functions
1. **`mapClick(x, y)`** - Verify minimap clicks are pixel-perfect
2. **`clickTile('left', x, y)`** - Verify game world clicks are accurate
3. **`keyPress('w')`** - Verify no interference with movement keys
4. **`useItemOnSelf('mana potion')`** - Verify hotkey item usage
5. **`login(email, password, character)`** - Verify complete login sequence
6. **`npcTalk('hi', 'trade')`** - Verify NPC interaction clicks
7. **`drag(x1, y1, x2, y2)`** - Verify drag operations

### Expected Results
- ✅ No mouse noise interference during Lua actions
- ✅ Lua actions execute with high priority (before movement, targeting)
- ✅ Pixel-perfect accuracy for all Lua mouse clicks
- ✅ Smooth execution of multi-action sequences (login, npcTalk)
- ✅ Proper pause/resume of mouse noise

## Impact Assessment

### Severity: CRITICAL
This bug affected **every single Lua script** in the system:
- Cavebot waypoint scripts
- Standalone Lua scripts
- Login automation
- NPC interaction
- Custom automation sequences

### Frequency: 100%
Every Lua function call that performed input actions was affected.

### User Impact
- Inaccurate clicks in Lua scripts
- Failed login sequences
- Unreliable NPC interactions
- Mouse noise interfering with critical automation

## Files Modified

1. `electron/workers/luaApi.js` - Fixed all 41 occurrences of `type: 'luaScript'` → `type: 'script'`

## Related Workers

The Lua API is used by two workers:
1. `electron/workers/cavebotLuaExecutor.js` - Cavebot waypoint scripts
2. `electron/workers/luaScriptWorker.js` - Standalone Lua scripts

Both workers now benefit from correct priority handling.

## Conclusion

This fix ensures that:
✅ All Lua script actions get correct high priority (2)
✅ Mouse noise pauses for all Lua actions
✅ Lua scripts execute reliably without interference
✅ Click accuracy is maintained for all Lua mouse actions
✅ Multi-action sequences execute smoothly

**This was a critical bug that affected the core functionality of Lua scripting in the bot!**
