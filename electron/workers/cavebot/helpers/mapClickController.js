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
  workerState.parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'movement',
      action: {
        module: 'mouseController',
        method: 'leftClick',
        args: [x, y],
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
      workerState.logger(
        'warn',
        '[MapClick] Action timeout, proceeding anyway',
      );
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
      targetPos: null,
      lastObservedAt: 0,
      lastObservedPos: null,
      fallbackUntil: 0,
    };
  }

  const mc = workerState.mapClick;

  // If very short path AND not currently moving, use keyboard
  // Once we're in 'moving' or 'pending' mode, we commit to the map click regardless of path length
  if (
    mc.mode === 'idle' &&
    path.length <= (config.mapClickKeyboardOnlyThreshold ?? 4)
  ) {
    return 'keyboard';
  }

  // Honor fallback window
  if (mc.fallbackUntil && now < mc.fallbackUntil) {
    const remainingMs = mc.fallbackUntil - now;
    if (now % 5000 < 100) {
      // Log every ~5 seconds during fallback
      workerState.logger(
        'debug',
        `[MapClick] In keyboard fallback mode, ${Math.floor(remainingMs / 1000)}s remaining`,
      );
    }
    return 'keyboard';
  }

  // State: moving — keep hands off as long as we move
  if (mc.mode === 'moving') {
    // Check if we have arrived at the destination
    if (sameTile(playerPos, mc.targetPos)) {
      workerState.logger(
        'info',
        '[MapClick] Arrived at map-click destination. Switching to keyboard.',
      );
      mc.mode = 'idle';
      mc.targetPos = null; // Clear target
      mc.fallbackUntil = 0; // No fallback needed, we arrived successfully
      return 'keyboard';
    }

    if (!sameTile(playerPos, mc.lastObservedPos)) {
      const timeSinceLastMove = now - mc.lastObservedAt;
      workerState.logger(
        'debug',
        `[MapClick] Moved to {x:${playerPos.x}, y:${playerPos.y}, z:${playerPos.z}} (${timeSinceLastMove}ms since last tile, ${path.length} tiles remaining)`,
      );
      mc.lastObservedPos = playerPos ? { ...playerPos } : null;
      mc.lastObservedAt = now;
    }

    const stallDuration = now - mc.lastObservedAt;
    const stallThreshold = config.mapClickStallIntervalMs ?? 1000;
    if (stallDuration >= stallThreshold) {
      // Stalled: stop map-click mode and fall back to keyboard for 10–15s
      const fallbackDuration = randomInt(
        config.mapClickFallbackMinMs ?? 10000,
        config.mapClickFallbackMaxMs ?? 15000,
      );
      workerState.logger(
        'info',
        `[MapClick] Movement STALLED (no tile change for ${stallDuration}ms) - falling back to keyboard for ${Math.floor(fallbackDuration / 1000)}s`,
      );
      mc.mode = 'idle';
      mc.fallbackUntil = now + fallbackDuration;
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
        workerState.logger(
          'info',
          `[MapClick] Movement STARTED - player moved from {x:${mc.startPos.x}, y:${mc.startPos.y}, z:${mc.startPos.z}} to {x:${playerPos.x}, y:${playerPos.y}, z:${playerPos.z}}`,
        );
        mc.mode = 'moving';
        mc.lastObservedPos = playerPos ? { ...playerPos } : null;
        mc.lastObservedAt = now;
        return 'handled';
      } else {
        // Did not start — fall back to keyboard for 10–15s
        const fallbackDuration = randomInt(
          config.mapClickFallbackMinMs ?? 10000,
          config.mapClickFallbackMaxMs ?? 15000,
        );
        workerState.logger(
          'warn',
          `[MapClick] NO MOVEMENT after click - falling back to keyboard for ${Math.floor(fallbackDuration / 1000)}s`,
        );
        mc.mode = 'idle';
        mc.fallbackUntil = now + fallbackDuration;
        return 'keyboard';
      }
    }
    // Still within pending window: wait
    return 'handled';
  }

  // State: idle — consider attempting a minimap click (only initiate if path is long enough)
  const minPathLength = config.mapClickMinPathLength ?? 15;
  if (path.length >= minPathLength) {
    workerState.logger(
      'info',
      `[MapClick] Long path detected (${path.length} tiles >= ${minPathLength}), initiating minimap click`,
    );
    // Prefer one of the last 10 nodes excluding the final target
    const endExclusive = path.length - 1; // exclude final tile
    const startInclusive = Math.max(1, path.length - 11); // avoid index 0 (current pos)
    const lastTen = path.slice(startInclusive, endExclusive);

    // Select only candidates that are clickable within current minimap bounds
    const minimapRegion =
      workerState.globalState?.regionCoordinates?.regions?.minimapFull;
    if (!minimapRegion || !playerPos) {
      // Cannot compute minimap click — use keyboard
      return 'keyboard';
    }

    // Filter candidates to ones that translate to valid screen coords
    const clickable = [];
    for (let i = 0; i < lastTen.length; i++) {
      const node = lastTen[i];
      const coords = getMinimapClickCoords(
        node.x,
        node.y,
        playerPos,
        minimapRegion,
      );
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
        const coords = getMinimapClickCoords(
          node.x,
          node.y,
          playerPos,
          minimapRegion,
        );
        if (coords) {
          chosen = { node, coords };
          break;
        }
      }
    }

    if (chosen) {
      // CRITICAL: Capture startPos BEFORE sending the click!
      // If we capture it after, the player might have already moved during the await,
      // causing false "NO MOVEMENT" detection at 500ms timeout
      const capturedStartPos = playerPos ? { ...playerPos } : null;

      // Generate unique action ID for this click
      const actionId = `mapClick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const pathRemaining = path.length;
      const distanceToTarget = Math.sqrt(
        Math.pow(chosen.node.x - playerPos.x, 2) +
          Math.pow(chosen.node.y - playerPos.y, 2),
      );

      workerState.logger(
        'info',
        `[MapClick] CLICKING minimap at screen (${chosen.coords.x}, ${chosen.coords.y}) -> tile {x:${chosen.node.x}, y:${chosen.node.y}, z:${chosen.node.z}} | Path: ${pathRemaining} tiles | Distance: ${distanceToTarget.toFixed(1)} tiles`,
      );

      // Send the click and await its completion
      postMouseLeftClick(
        workerState,
        chosen.coords.x,
        chosen.coords.y,
        actionId,
      );
      const completionPromise = createActionCompletionPromise(
        workerState,
        actionId,
      );

      // Wait for the mouse action to complete before returning
      const success = await completionPromise;

      if (success) {
        workerState.logger('debug', '[MapClick] Click action completed');
      } else {
        workerState.logger(
          'warn',
          '[MapClick] Click action failed or timed out',
        );
      }

      mc.mode = 'pending';
      mc.attemptAt = now;
      mc.startPos = capturedStartPos;
      mc.targetPos = chosen.node; // Store the destination tile
      mc.lastObservedPos = capturedStartPos;
      mc.lastObservedAt = now;
      return 'handled';
    }

    // No clickable candidate — use keyboard
    workerState.logger(
      'debug',
      `[MapClick] No clickable tiles found on minimap (path length: ${path.length}), using keyboard`,
    );
    return 'keyboard';
  }

  // Default to keyboard walking
  return 'keyboard';
}
