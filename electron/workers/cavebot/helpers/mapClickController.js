// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/helpers/mapClickController.js

import { getAbsoluteClickCoordinates as getMinimapClickCoords } from '../../../utils/minimapClickTranslator.js';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sameTile(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function postMouseLeftClick(workerState, x, y, actionId) {
  // Route through input orchestrator via workerManager
  workerState.parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'movement',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: [x, y, 150], // Fast movement for cavebot
      },
      actionId,
    },
  });
}

function createActionCompletionPromise(workerState, actionId) {
  return new Promise((resolve) => {
    const messageHandler = (message) => {
      if (
        message.type === 'inputActionCompleted' &&
        message.payload?.actionId === actionId
      ) {
        workerState.parentPort.off('message', messageHandler);
        resolve(message.payload.success);
      }
    };
    workerState.parentPort.on('message', messageHandler);
    
    // Timeout after 2 seconds
    setTimeout(() => {
      workerState.parentPort.off('message', messageHandler);
      workerState.logger('warn', '[MapClick] Action timeout, proceeding anyway');
      resolve(false);
    }, 2000);
  });
}

// Returns 'handled' when map-click flow should suppress keyboard for this tick.
// Returns 'keyboard' when caller should proceed with keyboard walking this tick.
// Now async to properly await mouse action completion
export async function mapClickTick(workerState, config) {
  const now = Date.now();
  const path = workerState.path || [];
  const playerPos = workerState.playerMinimapPosition;

  // Ensure mapClick state fields exist
  if (!workerState.mapClick) {
    workerState.mapClick = {
      mode: 'idle', // 'idle' | 'pending' | 'moving'
      attemptAt: 0,
      startPos: null,
      lastObservedAt: 0,
      lastObservedPos: null,
      fallbackUntil: 0,
    };
  }

  const mc = workerState.mapClick;

  // If very short path, always keyboard
  if (path.length <= (config.mapClickKeyboardOnlyThreshold ?? 4)) {
    mc.mode = 'idle';
    mc.fallbackUntil = 0;
    return 'keyboard';
  }

  // Honor fallback window
  if (mc.fallbackUntil && now < mc.fallbackUntil) {
    return 'keyboard';
  }

  // State: moving — keep hands off as long as we move
  if (mc.mode === 'moving') {
    if (!sameTile(playerPos, mc.lastObservedPos)) {
      mc.lastObservedPos = playerPos ? { ...playerPos } : null;
      mc.lastObservedAt = now;
    }

    if (now - mc.lastObservedAt >= (config.mapClickStallIntervalMs ?? 500)) {
      // Stalled: stop map-click mode and fall back to keyboard for 10–15s
      workerState.logger('debug', '[MapClick] Movement stalled; falling back to keyboard.');
      mc.mode = 'idle';
      mc.fallbackUntil = now + randomInt(
        config.mapClickFallbackMinMs ?? 10000,
        config.mapClickFallbackMaxMs ?? 15000,
      );
      return 'keyboard';
    }

    // Still moving: do nothing this tick
    return 'handled';
  }

  // State: pending — waiting to see if movement started within 500ms
  if (mc.mode === 'pending') {
    if (now - mc.attemptAt >= (config.mapClickStartMoveTimeoutMs ?? 500)) {
      if (!sameTile(playerPos, mc.startPos)) {
        // Movement started
        workerState.logger('debug', '[MapClick] Movement started after click.');
        mc.mode = 'moving';
        mc.lastObservedPos = playerPos ? { ...playerPos } : null;
        mc.lastObservedAt = now;
        return 'handled';
      } else {
        // Did not start — fall back to keyboard for 10–15s
        workerState.logger('debug', '[MapClick] No movement after click; falling back to keyboard.');
        mc.mode = 'idle';
        mc.fallbackUntil = now + randomInt(
          config.mapClickFallbackMinMs ?? 10000,
          config.mapClickFallbackMaxMs ?? 15000,
        );
        return 'keyboard';
      }
    }
    // Still within pending window: wait
    return 'handled';
  }

  // State: idle — consider attempting a minimap click
  if (path.length >= (config.mapClickMinPathLength ?? 15)) {
    // Prefer one of the last 10 nodes excluding the final target
    const endExclusive = path.length - 1; // exclude final tile
    const startInclusive = Math.max(1, path.length - 11); // avoid index 0 (current pos)
    const lastTen = path.slice(startInclusive, endExclusive);

    // Select only candidates that are clickable within current minimap bounds
    const minimapRegion = workerState.globalState?.regionCoordinates?.regions?.minimapFull;
    if (!minimapRegion || !playerPos) {
      // Cannot compute minimap click — use keyboard
      return 'keyboard';
    }

    // Filter candidates to ones that translate to valid screen coords
    const clickable = [];
    for (let i = 0; i < lastTen.length; i++) {
      const node = lastTen[i];
      const coords = getMinimapClickCoords(node.x, node.y, playerPos, minimapRegion);
      if (coords) {
        clickable.push({ node, coords });
      }
    }

    // If none of the last 10 are clickable, try earlier along the path (still avoid final tile)
    let chosen = null;
    if (clickable.length > 0) {
      chosen = clickable[randomInt(0, clickable.length - 1)];
    } else {
      for (let idx = endExclusive - 1; idx >= 1; idx--) {
        const node = path[idx];
        const coords = getMinimapClickCoords(node.x, node.y, playerPos, minimapRegion);
        if (coords) {
          chosen = { node, coords };
          break;
        }
      }
    }

    if (chosen) {
      // Generate unique action ID for this click
      const actionId = `mapClick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      workerState.logger(
        'debug',
        `[MapClick] Clicking minimap at screen=(${chosen.coords.x},${chosen.coords.y}) -> targetTile=(${chosen.node.x},${chosen.node.y},${chosen.node.z}).`,
      );
      
      // Send the click and await its completion
      postMouseLeftClick(workerState, chosen.coords.x, chosen.coords.y, actionId);
      const completionPromise = createActionCompletionPromise(workerState, actionId);
      
      // Wait for the mouse action to complete before returning
      const success = await completionPromise;
      
      if (success) {
        workerState.logger('debug', '[MapClick] Click completed successfully');
      } else {
        workerState.logger('warn', '[MapClick] Click may have failed or timed out');
      }
      
      mc.mode = 'pending';
      mc.attemptAt = now;
      mc.startPos = playerPos ? { ...playerPos } : null;
      mc.lastObservedPos = playerPos ? { ...playerPos } : null;
      mc.lastObservedAt = now;
      return 'handled';
    }

    // No clickable candidate — use keyboard
    return 'keyboard';
  }

  // Default to keyboard walking
  return 'keyboard';
}
