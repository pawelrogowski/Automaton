// /workers/cavebot/helpers/actionUtils.js

// ====================== MODIFICATION START ======================
// Corrected path to go up three directories to the electron root
import { getAbsoluteGameWorldClickCoordinates } from '../../../utils/gameWorldClickTranslator.js';
// ======================= MODIFICATION END =======================

/**
 * A centralized helper to calculate absolute on-screen click coordinates for an action.
 * @param {object} globalState - The full global state object.
 * @param {object} targetCoords - The {x, y, z} of the target waypoint.
 * @param {object} playerPos - The player's current {x, y, z} position.
 * @param {string} clickOffset - The offset within the tile to click ('center', 'bottomRight', etc).
 * @returns {object|null} The {x, y} screen coordinates or null on failure.
 */
export function getAbsoluteClickCoordinatesForAction(
  globalState,
  targetCoords,
  playerPos,
  clickOffset,
) {
  const { gameWorld, tileSize } = globalState.regionCoordinates.regions;
  if (!gameWorld || !tileSize) {
    console.error(
      '[getAbsoluteClickCoordinatesForAction] Missing region coordinates for click.',
    );
    return null;
  }

  return getAbsoluteGameWorldClickCoordinates(
    targetCoords.x,
    targetCoords.y,
    playerPos,
    gameWorld,
    tileSize,
    clickOffset,
  );
}
