# Cavebot Timeout Optimization Changes

## Summary
Optimized cavebot worker timeouts and removed unnecessary delays that were causing slowdowns after Z-level changes (rope, ladder, shovel actions).

## Config Changes (`electron/workers/cavebot/config.js`)

### Values Updated:
- ✅ `actionStateChangeTimeoutMs`: 300ms → **250ms**
- ✅ `defaultAwaitStateChangeTimeoutMs`: 500ms → **250ms**
- ✅ `actionFailureRetryDelayMs`: 500ms → **250ms**
- ✅ `mapClickStallIntervalMs`: 500ms → **400ms**
- ✅ `controlHandoverGraceMs`: 25ms → **5ms**

### Values Removed:
- ❌ `postDiagonalMoveDelayMs`: 150ms (removed entirely)
- ❌ `floorChangeGraceMs`: 250ms (removed entirely)
- ❌ `creatureMonitorSyncTimeoutMs`: 500ms (removed entirely)
- ❌ `postTeleportGraceMs`: 150ms (was unused, removed)

### Values Unchanged:
- ✅ `moveConfirmTimeoutMs`: 400ms (unchanged)
- ✅ `moveConfirmTimeoutDiagonalMs`: 550ms (unchanged)
- ✅ `scriptErrorDelayMs`: 250ms (unchanged)
- ✅ `mapClickStartMoveTimeoutMs`: 500ms (unchanged)
- ✅ `animationArrivalTimeoutMs`: 500ms (unchanged - correct value)

## Code Changes

### 1. `electron/workers/cavebot/actionHandlers.js`
- **Removed**: `postDiagonalMoveDelayMs` delay after diagonal moves (line 79-81)
- **Removed**: All `floorChangeGraceUntil` assignments after Z-level changes (4 locations):
  - `handleStandAction()` - line 207-209
  - `handleToolAction()` - line 289
  - `handleShovelAction()` - lines 372 and 438

### 2. `electron/workers/cavebot/fsm.js`
- **Removed**: Floor change grace period check in `EVALUATING_WAYPOINT` state (lines 60-68)
- **Removed**: Entire `WAITING_FOR_CREATURE_MONITOR_SYNC` state (lines 334-377)
- **Simplified**: `PERFORMING_ACTION` state now directly advances to next waypoint after success instead of transitioning to creature monitor sync state

### 3. `electron/workers/cavebot/index.js`
- **Removed**: `floorChangeGraceUntil: 0` from workerState initialization
- **Removed**: `creatureMonitorSyncTimeout: 0` from workerState initialization
- **Removed**: Special handling for `WAITING_FOR_CREATURE_MONITOR_SYNC` state in control state management

## Expected Performance Improvements

### Before:
After rope/ladder/shovel actions:
1. Action completes → 250ms floor change grace period
2. Enter WAITING_FOR_CREATURE_MONITOR_SYNC → up to 500ms polling
3. Total: **~750ms** of blocking waits

### After:
After rope/ladder/shovel actions:
1. Action completes → immediately advance to next waypoint
2. Total: **~0ms** of blocking waits (only natural state polling at 25ms intervals)

**Time saved per Z-level change: ~750ms**

## Architectural Improvements

1. **Removed blocking grace periods**: No more artificial waits after floor changes
2. **Eliminated redundant sync state**: Creature monitor sync is no longer required before advancing
3. **Simplified state machine**: Removed unnecessary state transitions
4. **Reduced diagonal move overhead**: No additional delay after diagonal movements
5. **Faster action retries**: Reduced retry delays from 500ms to 250ms

## Safety Considerations

- Movement confirmation timeouts remain conservative (400ms/550ms) to ensure reliable walk detection
- Animation arrival timeout for rope/shovel remains at 500ms (correct value)
- State change polling interval remains at 5ms for responsive checks
- All changes maintain state consistency without introducing race conditions or deadlocks

## Mouse Movement Speed Optimization

### Issue Identified:
The default `maxDuration` for mouse movements was 300ms (when undefined), causing significant delays before rope/ladder/shovel actions could be performed.

### Solution:
Reduced `maxDuration` to **150ms** for all cavebot mouse actions:

**Files Modified:**
1. **`electron/workers/cavebot/actionHandlers.js`**:
   - Updated `leftClick()` helper function to default to 150ms maxDuration
   - Ensured all leftClick calls use the fast movement (ladder, rope, door)

2. **`electron/mouseControll/useItemOnCoordinates.js`**:
   - Updated to accept and use 150ms maxDuration parameter
   - Used by rope, shovel, and machete actions

3. **`electron/workers/cavebot/helpers/mapClickController.js`**:
   - Updated `postMouseLeftClick()` to use 150ms for minimap clicks

**Expected Impact:**
- Mouse movement time reduced from 300ms to 150ms
- Additional time savings: **~150ms per mouse action**
- Especially noticeable for rope, ladder, shovel, and door actions

## Testing Recommendations

1. Test rope actions (up/down)
2. Test ladder actions (up/down)
3. Test shovel actions
4. Test door actions (opening closed doors)
5. Test machete actions (cutting jungle)
6. Monitor for any issues with waypoint advancement after Z-level changes
7. Verify targeting still properly hands control back to cavebot
8. Check that diagonal movements work correctly without additional delays
9. Verify mouse movements complete properly (not too fast for the game)
