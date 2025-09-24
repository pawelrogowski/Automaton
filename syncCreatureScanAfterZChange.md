# Synchronization of Creature Scan After Z-Level Change

## Problem Context

In the current application, a race condition frequently occurs when the `cavebotWorker` executes a waypoint that involves a Z-level change, such as climbing a ladder. Although the ladder action itself completes successfully, the `cavebotWorker` immediately advances to the next waypoint in its sequence. This rapid advancement happens before the `creatureMonitor` has had sufficient time to fully process the new screen capture and detect monsters on the updated floor. Consequently, the `targetingWorker` lacks up-to-date creature information to acquire a target. This often results in the bot moving away from the newly entered, monster-filled room (e.g., immediately going down a ladder) instead of engaging the creatures.

The core issue is a timing and synchronization gap: there is no explicit handshake or signal from `creatureMonitor` to `cavebotWorker` confirming that the new Z-level has been scanned and creature data is updated in the SharedArrayBuffers (SABs). The existing Z-level mismatch check in `cavebot/index.js` is not the cause, as it correctly evaluates after the player's Z-level has changed. The problem is the lack of a waiting mechanism for the `creatureMonitor`'s scan to complete.

## Proposed Solution

To address this, a robust handshake mechanism will be implemented between `creatureMonitor` and `cavebotWorker` using SharedArrayBuffers (SABs). This will ensure that after a Z-level change, the `cavebotWorker` waits for an explicit confirmation that `creatureMonitor` has scanned the new floor before proceeding. This solution is atomic, focused, and avoids modifications to the `targetingWorker` or Redux state.

The solution consists of three main parts:

1.  **Explicit Handshake Signal**: `creatureMonitor` will explicitly signal when it has completed a scan of the current Z-level by writing the `playerMinimapPosition.z` to a new dedicated field in `CREATURES_SAB`.
2.  **Cavebot Waits for Scan Confirmation**: After a successful Z-level change, `cavebotWorker` will enter a new FSM state where it polls the SAB for the `creatureMonitor`'s "scan complete" signal for the current Z-level. It will include a timeout to prevent indefinite waiting.
3.  **Targeting Worker Pauses Movement During Grace Period**: The `targetingWorker` will be aware of this post-floor-change grace period. During this time, it will continue to scan for and acquire targets, but it will temporarily refrain from initiating any movement commands.

## Detailed Implementation Plan

### Part 1: Extend Shared Constants (`electron/workers/sharedConstants.js`)

A new constant will be added to `CREATURES_SAB` to store the `lastProcessedZLevel` by `creatureMonitor`.

```javascript
// In electron/workers/sharedConstants.js
// ... existing CREATURES_SAB constants ...

// New index for CreatureMonitor's last processed Z-level
export const CREATURE_MONITOR_LAST_PROCESSED_Z_INDEX = CREATURES_DATA_START_INDEX + MAX_CREATURES * CREATURE_DATA_SIZE;
// Update total size of CREATURES_SAB
export const CREATURES_SAB_SIZE = CREATURE_MONITOR_LAST_PROCESSED_Z_INDEX + 1;
```

### Part 2: Extend SABStateManager (`electron/workers/sabStateManager.js`)

Methods will be added to `SABStateManager` to read and write this new Z-level.

```javascript
// In electron/workers/sabStateManager.js, inside SABStateManager class
import {
  // ... existing imports ...
  CREATURE_MONITOR_LAST_PROCESSED_Z_INDEX, // Import the new constant
} from './sharedConstants.js';

// ... existing methods ...

writeCreatureMonitorLastProcessedZ(zLevel) {
  if (!this.creaturesArray) return;
  Atomics.store(this.creaturesArray, CREATURE_MONITOR_LAST_PROCESSED_Z_INDEX, zLevel);
}

readCreatureMonitorLastProcessedZ() {
  if (!this.creaturesArray) return null;
  return Atomics.load(this.creaturesArray, CREATURE_MONITOR_LAST_PROCESSED_Z_INDEX);
}
```

### Part 3: Creature Monitor Signals Scan Completion (`electron/workers/creatureMonitor.js`)

In `creatureMonitor.js`, it will read the `currentPlayerMinimapPosition.z` at the beginning of its `performOperation` function and then write it after `sabStateManager.writeWorldState(...)`.

```javascript
// In electron/workers/creatureMonitor.js, inside performOperation
try {
  const startTime = performance.now();

  if (
    !isInitialized ||
    !currentState?.regionCoordinates?.regions ||
    !pathfinderInstance?.isLoaded
  )
    return;
  const { regions } = currentState.regionCoordinates;
  const { gameWorld, tileSize } = regions;
  if (!gameWorld || !tileSize) return;

  // NEW: Get player position at the start of the scan
  const zLevelAtScanStart = Atomics.load(playerPosArray, PLAYER_Z_INDEX);

  // ... existing logic ...

  sabStateManager.writeWorldState({
    creatures: detectedEntities,
    target: unifiedTarget,
    battleList: battleListEntries,
  });

  // NEW: Signal CreatureMonitor has processed this Z-level (from the start of the scan)
  sabStateManager.writeCreatureMonitorLastProcessedZ(zLevelAtScanStart);

  // ... rest of performOperation logic ...
} catch (error) {
  // ... error handling ...
}
```

### Part 4: Cavebot Waits for Scan Confirmation (`electron/workers/cavebot/fsm.js` and `electron/workers/cavebot/config.js`)

*   **`electron/workers/cavebot/config.js`**: A new configuration for the timeout duration will be added.

    ```javascript
    // In electron/workers/cavebot/config.js
    export const config = {
      // ... existing config ...
      creatureMonitorSyncTimeoutMs: 1000, // Timeout for CreatureMonitor Z-level sync
    };
    ```

*   **`electron/workers/cavebot/fsm.js`**: A new FSM state, `WAITING_FOR_CREATURE_MONITOR_SYNC`, will be added, and the `PERFORMING_ACTION` state will be modified to transition to it after a Z-level changing action.

    ```javascript
    // In electron/workers/cavebot/fsm.js
    // ... existing FSM states ...

    PERFORMING_ACTION: {
      enter: () => {
        logger('debug', '[FSM] Entering PERFORMING_ACTION state.');
        postStoreUpdate('cavebot/setActionPaused', true);
      },
      execute: async (context) => {
        const { targetWaypoint } = context;
        // ... existing waypoint sections logic ...
        let actionSucceeded = false;
        const targetCoords = {
          x: targetWaypoint.x,
          y: targetWaypoint.y,
          z: targetWaypoint.z,
        };
        // ... switch case for actions ...

        if (actionSucceeded) {
          logger(
            'debug',
            `[FSM] Action '${targetWaypoint.type}' succeeded.`,
          );
          if (
            getDistance(workerState.playerMinimapPosition, targetWaypoint) >=
            config.teleportDistanceThreshold ||
            targetWaypoint.type === 'Ladder' || // Explicitly include Ladder type
            targetWaypoint.type === 'Rope' ||
            targetWaypoint.type === 'Shovel'
          ) {
            logger(
              'debug',
              '[FSM] Teleport-like action detected, transitioning to WAITING_FOR_CREATURE_MONITOR_SYNC.',
            );
            return 'WAITING_FOR_CREATURE_MONITOR_SYNC';
          } else {
            logger(
              'debug',
              '[FSM] Actionless waypoint reached. Advancing to next.',
            );
            await advanceToNextWaypoint(workerState, config);
            return 'IDLE';
          }
        } else {
          // ... existing action failed logic ...
          return 'EVALUATING_WAYPOINT';
        }
      },
    },

    WAITING_FOR_CREATURE_MONITOR_SYNC: {
      enter: () => {
        logger('debug', '[FSM] Entering WAITING_FOR_CREATURE_MONITOR_SYNC state.');
        postStoreUpdate('cavebot/setActionPaused', true); // Keep cavebot actions paused
        workerState.creatureMonitorSyncTimeout = Date.now() + config.creatureMonitorSyncTimeoutMs; // Set timeout
      },
      execute: async (context) => {
        const { playerPos } = context;
        const now = Date.now();

        // Check for timeout
        if (now >= workerState.creatureMonitorSyncTimeout) {
          logger('warn', '[FSM] Timeout waiting for CreatureMonitor sync. Proceeding without explicit confirmation.');
          await advanceToNextWaypoint(workerState, config); // Proceed anyway
          return 'IDLE';
        }

        // Read the last processed Z-level from CreatureMonitor via SAB
        const lastProcessedZ = workerState.sabStateManager.readCreatureMonitorLastProcessedZ();

        if (lastProcessedZ === playerPos.z) {
          logger('info', '[FSM] CreatureMonitor sync confirmed for current Z-level. Advancing waypoint.');
          await advanceToNextWaypoint(workerState, config);
          return 'IDLE';
        }

        logger('debug', '[FSM] Waiting for CreatureMonitor to sync for current Z-level.');
        await delay(config.stateChangePollIntervalMs); // Poll frequently
        return 'WAITING_FOR_CREATURE_MONITOR_SYNC'; // Stay in this state
      },
    },

    // ... existing FSM states ...
    ```

### Part 5: Cavebot Worker State Initialization (`electron/workers/cavebot/index.js`)

Initialize `creatureMonitorSyncTimeout` in `workerState`.

```javascript
// In electron/workers/cavebot/index.js, inside workerState object
const workerState = {
  // ... existing state ...
  creatureMonitorSyncTimeout: 0, // Initialize the timeout
  // ... rest of state ...
};
