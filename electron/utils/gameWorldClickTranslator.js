const TILE_WIDTH = 72;
const TILE_HEIGHT = 72;

// Game world region from electron/workers/regionMonitor.js
const GAME_WORLD_REGION = { x: 330, y: 6, width: 1086, height: 796 };

// Player's fixed position on the screen within the game world window (0-indexed)
const PLAYER_SCREEN_TILE_X = 7; // 8th tile from the left
const PLAYER_SCREEN_TILE_Y = 5; // 6th tile from the top

/**
 * Generates a random integer between min (inclusive) and max (inclusive).
 */
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Translates absolute in-game world coordinates to absolute screen coordinates for clicking.
 * Assumes playerMinimapPosition is the global coordinate of the tile the player is currently on.
 * @param {number} targetGameX - The target absolute X coordinate in the game world.
 * @param {number} targetGameY - The target absolute Y coordinate in the game world.
 * @param {{x: number, y: number, z: number}} playerMinimapPosition - The player's current absolute position in the game world (from gameStateSlice).
 * @param {'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'} [targetPoint='center'] - The specific point within the tile to target.
 * @returns {{x: number, y: number}|null} The absolute screen coordinates for the click, or null if inputs are invalid.
 */
export function getAbsoluteGameWorldClickCoordinates(targetGameX, targetGameY, playerMinimapPosition, targetPoint = 'center') {
  if (!playerMinimapPosition) {
    console.error('Missing playerMinimapPosition for game world coordinate translation.');
    return null;
  }

  // Calculate the difference in global game coordinates (in tiles)
  const deltaTilesX = targetGameX - playerMinimapPosition.x;
  const deltaTilesY = targetGameY - playerMinimapPosition.y;

  // Calculate the top-left pixel of the player's tile on screen
  const playerScreenPixelX_topLeft = GAME_WORLD_REGION.x + PLAYER_SCREEN_TILE_X * TILE_WIDTH;
  const playerScreenPixelY_topLeft = GAME_WORLD_REGION.y + PLAYER_SCREEN_TILE_Y * TILE_HEIGHT;

  // Calculate the top-left pixel of the target tile on screen
  let targetTileScreenPixelX = playerScreenPixelX_topLeft + deltaTilesX * TILE_WIDTH;
  let targetTileScreenPixelY = playerScreenPixelY_topLeft + deltaTilesY * TILE_HEIGHT;

  // Adjust based on targetPoint within the tile
  let finalClickX = targetTileScreenPixelX;
  let finalClickY = targetTileScreenPixelY;

  switch (targetPoint) {
    case 'topRight':
      finalClickX += TILE_WIDTH;
      break;
    case 'bottomLeft':
      finalClickY += TILE_HEIGHT;
      break;
    case 'bottomRight':
      finalClickX += TILE_WIDTH - 5;
      finalClickY += TILE_HEIGHT - 5;
      break;
    case 'center':
    default:
      finalClickX += TILE_WIDTH / 2;
      finalClickY += TILE_HEIGHT / 2;
      // Apply randomization for center clicks
      finalClickX += getRandomInt(-15, 15);
      finalClickY += getRandomInt(-15, 15);
      break;
  }

  return { x: finalClickX, y: finalClickY };
}
