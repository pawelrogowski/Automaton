// electron/workers/movementUtils/confirmationHelpers.js

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for movement confirmation by detecting actual position changes in unified SAB.
 * Used by both cavebot and targeting workers to ensure reliable movement.
 *
 * @param {Object} workerState - Worker state with sabInterface or playerMinimapPosition
 * @param {Object} config - Configuration object with stateChangePollIntervalMs
 * @param {number} timeoutMs - Maximum time to wait for confirmation
 * @returns {Promise<boolean>} Resolves true if movement confirmed, rejects on timeout
 */
export const awaitWalkConfirmation = (workerState, config, timeoutMs) => {
  return new Promise((resolve, reject) => {
    // Store initial position to detect changes
    const initialPos = { ...workerState.playerMinimapPosition };

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error(`awaitWalkConfirmation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const intervalId = setInterval(() => {
      // Read position directly from SAB on each poll
      let currentPos = null;
      if (workerState.sabInterface) {
        try {
          const posResult = workerState.sabInterface.get('playerPos');
          if (posResult && posResult.data) {
            currentPos = posResult.data;
          }
        } catch (err) {
          // Fallback to workerState cached value
          currentPos = workerState.playerMinimapPosition;
        }
      } else {
        currentPos = workerState.playerMinimapPosition;
      }

      // ONLY check if position actually changed!
      const posChanged =
        currentPos &&
        initialPos &&
        (currentPos.x !== initialPos.x ||
          currentPos.y !== initialPos.y ||
          currentPos.z !== initialPos.z);

      // ONLY resolve when position actually changes - no legacy counter checks!
      if (posChanged) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        resolve(true);
      }
    }, config.stateChangePollIntervalMs);
  });
};

/**
 * Get direction key for movement between two positions.
 *
 * @param {Object} current - Current position {x, y, z}
 * @param {Object} target - Target position {x, y, z}
 * @returns {string|null} Direction key ('q','w','e','a','d','z','s','c') or null
 */
export const getDirectionKey = (current, target) => {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (dy < 0) {
    if (dx < 0) return 'q';
    if (dx === 0) return 'w';
    if (dx > 0) return 'e';
  } else if (dy === 0) {
    if (dx < 0) return 'a';
    if (dx > 0) return 'd';
  } else if (dy > 0) {
    if (dx < 0) return 'z';
    if (dx === 0) return 's';
    if (dx > 0) return 'c';
  }
  return null;
};

/**
 * Check if a direction key represents diagonal movement.
 *
 * @param {string} dirKey - Direction key to check
 * @returns {boolean} True if diagonal movement
 */
export const isDiagonalMovement = (dirKey) => {
  return ['q', 'e', 'z', 'c'].includes(dirKey);
};

/**
 * Get appropriate timeout based on movement type.
 * Diagonal movements take longer than straight movements.
 *
 * @param {string} dirKey - Direction key
 * @param {Object} config - Configuration object with timeout settings
 * @returns {number} Timeout in milliseconds
 */
export const getMovementTimeout = (dirKey, config) => {
  return isDiagonalMovement(dirKey)
    ? config.moveConfirmTimeoutDiagonalMs
    : config.moveConfirmTimeoutMs;
};
