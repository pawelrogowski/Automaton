# Cavebot Priority Type Verification

## Question
Should all cavebot actions be classified as `type: 'movement'` priority?

## Answer
✅ **YES - Already Correctly Implemented**

## Verification Results

### All Cavebot Actions Use `type: 'movement'`

#### **Walking Actions** (`electron/workers/cavebot/actionHandlers.js`)
- ✅ Line 71: `keyPress(dirKey, { type: 'movement' });` - Regular walking
- ✅ Line 193: `keyPress(dirKey, { type: 'movement' });` - Stand action walking

#### **Tool Actions** (`electron/workers/cavebot/actionHandlers.js`)
- ✅ Line 256: Ladder clicks - `{ type: 'movement' }`
- ✅ Line 258: Rope hotkey - `{ type: 'movement' }`
- ✅ Line 260: Rope clicks - `{ type: 'movement' }`
- ✅ Line 263: Shovel use (first location) - `{ type: 'movement' }`
- ✅ Line 411: Shovel use (second location) - `{ type: 'movement' }`
- ✅ Line 505: Machete use - `{ type: 'movement' }`

#### **Door Actions** (`electron/workers/cavebot/actionHandlers.js`)
- ✅ Line 599: Door clicks - `{ type: 'movement' }`

#### **Map Clicks** (`electron/workers/cavebot/helpers/mapClickController.js`)
- ✅ Line 19: Minimap clicks - `type: 'movement'`

### Helper Functions Correctly Forward Type

#### **keyPress.js** (`electron/keyboardControll/keyPress.js`)
```javascript
export const keyPress = (key, { modifier = null, type = 'default' } = {}) => {
  post({
    type,  // ✅ Forwards the type parameter
    action: { module: 'keypress', method: 'sendKey', args: [key, modifier] }
  });
};
```

#### **useItemOnCoordinates.js** (`electron/mouseControll/useItemOnCoordinates.js`)
```javascript
function useItemOnCoordinates(targetX, targetY, key, { type = 'default', maxDuration = 150 } = {}) {
  keyPress(key, { type });  // ✅ Forwards to keyPress
  post({
    type,  // ✅ Forwards to mouse click
    action: { module: 'mouseController', method: 'leftClick', ... }
  });
}
```

## Priority System Integration

All cavebot actions correctly use `type: 'movement'` which:

1. **Gets Priority 4** in the input orchestrator
   ```javascript
   const PRIORITY_MAP = {
     userRule: 0,
     looting: 1,
     script: 2,
     targeting: 3,
     movement: 4,  // ✅ Cavebot priority
     hotkey: 5,
     mouseNoise: 100,
   };
   ```

2. **Triggers Mouse Noise Pause**
   ```javascript
   const PAUSE_MOUSE_NOISE_FOR = new Set([
     'userRule', 'looting', 'script', 'targeting',
     'movement',  // ✅ Pauses noise for cavebot actions
     'hotkey',
   ]);
   ```

3. **Ensures Proper Sequencing**
   - Mouse noise (priority 100) always executes AFTER movement actions (priority 4)
   - Noise is paused BEFORE movement actions start
   - Noise resumes AFTER movement actions complete

## Why This is Correct

### All cavebot actions should be `type: 'movement'` because:

1. **Walking** - Core movement mechanic
2. **Tool actions (rope/shovel/machete)** - These are movement enablers that clear obstacles or create paths
3. **Ladder** - Floor transitions are movement
4. **Doors** - Opening doors to enable movement
5. **Map clicks** - Direct movement command to specific location
6. **Stand actions** - Positional movement

### Exception: Scripts
Script waypoints use `type: 'script'` (priority 2, higher than movement) because they may contain:
- User rule executions
- Complex logic
- State changes
- Navigation commands

This is handled separately in `handleScriptAction()` and doesn't use the standard action handlers.

## Conclusion

✅ **All cavebot actions are correctly classified as `type: 'movement'`**  
✅ **Helper functions properly forward the type parameter**  
✅ **Mouse noise interference is prevented for all cavebot actions**  
✅ **Priority system ensures correct execution order**

No changes needed - the architecture is correct and robust!
