import { parentPort } from 'worker_threads';
import { createLogger } from '../utils/logger.js';

const log = createLogger({
  info: false,
  error: true,
  debug: false,
});

// ==================== CONFIGURATION ====================

const MOUSE_NOISE_CONFIG = {
  ENABLED: true,
  MOVEMENT_INTERVAL_MS: 200, // Send new position every 200ms (was flooding queue at 50ms)

  // Speed ranges (pixels per second)
  SPEED_RANGES: {
    slow: { min: 50, max: 150 },
    medium: { min: 150, max: 400 },
    fast: { min: 400, max: 800 },
  },

  // Speed change probabilities
  SPEED_WEIGHTS: {
    slow: 0.4,
    medium: 0.8,
    fast: 2,
  },

  // How often to change direction/speed (ms)
  PATTERN_CHANGE_INTERVAL: {
    min: 500,
    max: 3000,
  },

  // Pause probability (chance per pattern change)
  PAUSE_PROBABILITY: 0.15,
  PAUSE_DURATION: { min: 500, max: 5000 },

  // Region preferences (where to move) - constrained to gameWorld only
  REGION_WEIGHTS: {
    gameWorld: 1.0, // Always stay in game world (100%)
  },
};

// ==================== STATE ====================

let globalState = null;
let isPaused = false;
let isActive = false;

// Current movement state
let currentPosition = { x: 0, y: 0 }; // Current mouse position
let targetPosition = { x: 0, y: 0 }; // Where we're heading
let currentSpeed = 0; // Pixels per second
let lastPatternChange = 0; // When we last changed direction/speed
let nextPatternChange = 0; // When to change next
let isPausing = false; // Currently in a pause
let pauseEndTime = 0; // When pause ends

// Track keyboard activity for reduced mouse movement
let recentKeyboardActivity = false;
let keyboardActivityTimeout = null;

// ==================== HELPER FUNCTIONS ====================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weightedChoice(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let random = Math.random() * total;

  for (const [key, weight] of entries) {
    random -= weight;
    if (random <= 0) return key;
  }

  return entries[0][0]; // Fallback
}

function getRandomInRange(range) {
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}

function getRandomPointInRegion(region) {
  if (!region) return null;

  const x = region.x + Math.floor(Math.random() * region.width);
  const y = region.y + Math.floor(Math.random() * region.height);

  return { x, y };
}

function isPointInRegion(point, region) {
  if (!point || !region) return false;
  return (
    point.x >= region.x &&
    point.x < region.x + region.width &&
    point.y >= region.y &&
    point.y < region.y + region.height
  );
}

function selectTargetRegion() {
  const regions = globalState?.regionCoordinates?.regions;
  if (!regions) return null;

  // Always return gameWorld - movements are constrained to game area only
  return regions.gameWorld;
}

function selectNewTarget() {
  const targetRegion = selectTargetRegion();
  if (!targetRegion) return null;

  return getRandomPointInRegion(targetRegion);
}

function selectNewSpeed() {
  // Adjust speed if keyboard is active
  if (recentKeyboardActivity) {
    // Slower movement during typing
    const range = MOUSE_NOISE_CONFIG.SPEED_RANGES.slow;
    return getRandomInRange(range);
  }

  const speedType = weightedChoice(MOUSE_NOISE_CONFIG.SPEED_WEIGHTS);
  const range = MOUSE_NOISE_CONFIG.SPEED_RANGES[speedType];
  return getRandomInRange(range);
}

function shouldPause() {
  // Higher pause probability during keyboard activity
  const baseProbability = MOUSE_NOISE_CONFIG.PAUSE_PROBABILITY;
  const adjustedProbability = recentKeyboardActivity
    ? baseProbability * 2
    : baseProbability;
  return Math.random() < adjustedProbability;
}

function startNewPattern() {
  const now = Date.now();

  // Only allow pausing when cursor is over the gameWorld region
  const gameWorld = globalState?.regionCoordinates?.regions?.gameWorld;
  const canPauseHere =
    !!gameWorld && isPointInRegion(currentPosition, gameWorld);

  // Decide: pause or move?
  if (canPauseHere && shouldPause()) {
    isPausing = true;
    pauseEndTime = now + getRandomInRange(MOUSE_NOISE_CONFIG.PAUSE_DURATION);
    log('debug', `[MouseNoise] Starting pause until ${pauseEndTime}`);
    return;
  }

  isPausing = false;

  // Select new target and speed
  const newTarget = selectNewTarget();
  if (newTarget) {
    targetPosition = newTarget;
    currentSpeed = selectNewSpeed();

    // Schedule next pattern change
    const changeInterval = getRandomInRange(
      MOUSE_NOISE_CONFIG.PATTERN_CHANGE_INTERVAL,
    );
    nextPatternChange = now + changeInterval;

    log(
      'debug',
      `[MouseNoise] New target (${targetPosition.x}, ${targetPosition.y}) at ${currentSpeed} px/s for ${changeInterval}ms`,
    );
  }
}

// ==================== CONTINUOUS MOVEMENT ====================

function calculateNextPosition(deltaMs) {
  // If pausing, don't move
  if (isPausing) {
    return currentPosition;
  }

  // Calculate how far to move based on speed and time
  const deltaSec = deltaMs / 1000;
  const maxDistance = currentSpeed * deltaSec;

  // Calculate direction to target
  const dx = targetPosition.x - currentPosition.x;
  const dy = targetPosition.y - currentPosition.y;
  const distanceToTarget = Math.sqrt(dx * dx + dy * dy);

  // If very close to target or target reached, we're there
  if (distanceToTarget < 2) {
    return targetPosition;
  }

  // Move toward target
  const moveDistance = Math.min(maxDistance, distanceToTarget);
  const ratio = moveDistance / distanceToTarget;

  const nextPos = {
    x: Math.round(currentPosition.x + dx * ratio),
    y: Math.round(currentPosition.y + dy * ratio),
  };

  // CRITICAL: Ensure next position stays within gameWorld boundaries
  const gameWorld = globalState?.regionCoordinates?.regions?.gameWorld;
  if (gameWorld) {
    nextPos.x = Math.max(
      gameWorld.x,
      Math.min(nextPos.x, gameWorld.x + gameWorld.width - 1),
    );
    nextPos.y = Math.max(
      gameWorld.y,
      Math.min(nextPos.y, gameWorld.y + gameWorld.height - 1),
    );
  }

  return nextPos;
}

async function sendMouseMove(x, y) {
  // CRITICAL FIX: Check if paused BEFORE sending to queue
  // This prevents noise moves from being sent when critical actions are executing
  if (isPaused) {
    log('debug', '[MouseNoise] Skipping move - paused by orchestrator');
    return;
  }

  const display = globalState?.global?.display;

  if (!display) {
    log('debug', '[MouseNoise] Missing display, cannot send move');
    return;
  }

  log(
    'debug',
    `[MouseNoise] Sending XTest cursor move to absolute (${x}, ${y})`,
  );

  // Send XTest absolute cursor movement (no windowId needed - system level)
  parentPort.postMessage({
    type: 'inputAction',
    payload: {
      type: 'mouseNoise',
      action: {
        module: 'mouseController',
        method: 'xtestMoveCursor',
        args: [x, y, display], // Absolute screen coordinates
      },
    },
  });
}

// ==================== MAIN LOOP ====================

async function noiseLoop() {
  log('info', '[MouseNoise] Continuous noise loop started');

  let lastUpdateTime = Date.now();

  // Initialize first pattern
  startNewPattern();

  while (isActive) {
    const now = Date.now();
    const deltaMs = now - lastUpdateTime;
    lastUpdateTime = now;

    // Check if externally paused
    if (isPaused) {
      await delay(MOUSE_NOISE_CONFIG.MOVEMENT_INTERVAL_MS);
      continue;
    }

    // Check if we have necessary state
    if (
      !globalState?.global?.windowId ||
      !globalState?.regionCoordinates?.regions
    ) {
      log('debug', '[MouseNoise] Waiting for window/regions state...');
      await delay(1000);
      continue;
    }

    // Only generate noise if cavebot or targeting is enabled
    const cavebotEnabled = globalState?.cavebot?.enabled ?? false;
    const targetingEnabled = globalState?.targeting?.enabled ?? false;

    if (!cavebotEnabled && !targetingEnabled) {
      log(
        'debug',
        '[MouseNoise] Waiting for cavebot or targeting to be enabled...',
      );
      await delay(1000);
      continue;
    }

    try {
      // Initialize current position if needed (center of gameWorld)
      if (currentPosition.x === 0 && currentPosition.y === 0) {
        const gameWorld = globalState.regionCoordinates.regions.gameWorld;
        if (gameWorld) {
          currentPosition = {
            x: gameWorld.x + Math.floor(gameWorld.width / 2),
            y: gameWorld.y + Math.floor(gameWorld.height / 2),
          };
          log(
            'info',
            `[MouseNoise] Initialized position to center of gameWorld: (${currentPosition.x}, ${currentPosition.y}) - gameWorld bounds: ${gameWorld.x},${gameWorld.y} ${gameWorld.width}x${gameWorld.height}`,
          );
        }
      }

      // SAFETY CHECK: Ensure current position is within gameWorld bounds
      const gameWorld = globalState.regionCoordinates.regions.gameWorld;
      if (gameWorld && !isPointInRegion(currentPosition, gameWorld)) {
        log(
          'warn',
          `[MouseNoise] Current position (${currentPosition.x}, ${currentPosition.y}) is outside gameWorld! Resetting to center.`,
        );
        currentPosition = {
          x: gameWorld.x + Math.floor(gameWorld.width / 2),
          y: gameWorld.y + Math.floor(gameWorld.height / 2),
        };
      }

      // Check if we need to change pattern
      if (now >= nextPatternChange && !isPausing) {
        startNewPattern();
      }

      // If we're paused but somehow not over gameWorld (should never happen now), cancel the pause
      if (isPausing) {
        const gameWorld = globalState?.regionCoordinates?.regions?.gameWorld;
        if (!isPointInRegion(currentPosition, gameWorld)) {
          log(
            'warn',
            `[MouseNoise] Paused but not in gameWorld - this should not happen! Resetting.`,
          );
          isPausing = false;
          currentPosition = {
            x: gameWorld.x + Math.floor(gameWorld.width / 2),
            y: gameWorld.y + Math.floor(gameWorld.height / 2),
          };
          startNewPattern();
        }
      }

      // Check if pause ended
      if (isPausing && now >= pauseEndTime) {
        startNewPattern();
      }

      // Calculate and send next position
      if (!isPausing) {
        const nextPos = calculateNextPosition(deltaMs);

        // Only send if position actually changed
        if (
          nextPos.x !== currentPosition.x ||
          nextPos.y !== currentPosition.y
        ) {
          currentPosition = nextPos;
          await sendMouseMove(currentPosition.x, currentPosition.y);
        }
      }

      // Wait for next update interval
      await delay(MOUSE_NOISE_CONFIG.MOVEMENT_INTERVAL_MS);
    } catch (error) {
      log('error', '[MouseNoise] Error in noise loop:', error);
      await delay(1000);
    }
  }

  log('info', '[MouseNoise] Noise loop stopped');
}

// ==================== MESSAGE HANDLERS ====================

parentPort.on('message', (message) => {
  // Full state sync comes as plain object without type field
  if (typeof message === 'object' && !message.type) {
    log('info', '[MouseNoise] Received full state sync');
    globalState = message;
    log(
      'info',
      `[MouseNoise] Has windowId: ${!!globalState?.global?.windowId}, Has regions: ${!!globalState?.regionCoordinates?.regions}`,
    );
    return;
  }

  // State diffs come with type: 'state_diff'
  if (message.type === 'state_diff') {
    log('debug', '[MouseNoise] Received state diff');
    if (!globalState) globalState = {};
    Object.assign(globalState, message.payload);
    return;
  }

  if (message.type === 'pauseMouseNoise') {
    isPaused = true;
    log('info', '[MouseNoise] Paused - critical mouse action in progress');
    return;
  }

  if (message.type === 'resumeMouseNoise') {
    isPaused = false;
    log('info', '[MouseNoise] Resumed - critical actions completed');
    return;
  }

  if (message.type === 'mouseNoiseEnable') {
    MOUSE_NOISE_CONFIG.ENABLED = message.payload?.enabled ?? true;
    log(
      'info',
      `[MouseNoise] ${MOUSE_NOISE_CONFIG.ENABLED ? 'Enabled' : 'Disabled'}`,
    );
    return;
  }

  if (message.type === 'keyboardActivity') {
    // Track keyboard activity to reduce mouse movement
    recentKeyboardActivity = true;
    clearTimeout(keyboardActivityTimeout);
    keyboardActivityTimeout = setTimeout(() => {
      recentKeyboardActivity = false;
    }, 2000); // Consider typing active for 2s after last keypress
    return;
  }

  if (message.type === 'shutdown') {
    log('info', '[MouseNoise] Shutting down...');
    isActive = false;
    return;
  }
});

// ==================== STARTUP ====================

log('info', '[MouseNoise] Worker started');

if (MOUSE_NOISE_CONFIG.ENABLED) {
  isActive = true;
  noiseLoop().catch((error) => {
    log('error', '[MouseNoise] Fatal error in noise loop:', error);
    isActive = false;
  });
}

log('info', '[MouseNoise] Initialized and listening for messages');
