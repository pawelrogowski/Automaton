// Player's fixed position on the screen within the game world window (0-indexed).
// This is a design constant representing the center of the viewport.
const PLAYER_SCREEN_TILE_X = 7; // 8th tile from the left
const PLAYER_SCREEN_TILE_Y = 5; // 6th tile from the top

/**
 * Translates absolute in-game world coordinates to absolute screen coordinates for clicking.
 * This function is pure and relies on dynamically detected region data passed as arguments.
 *
 * @param {number} targetGameX - The target absolute X coordinate in the game world.
 * @param {number} targetGameY - The target absolute Y coordinate in the game world.
 * @param {{x: number, y: number, z: number}} playerMinimapPosition - The player's current absolute position.
 * @param {object} gameWorldRegion - The dynamically found gameWorld region object {x, y, width, height}.
 * @param {object} tileSize - The dynamically calculated tile size object {width, height}.
 * @param {'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'} [targetPoint='center'] - The specific point within the tile to target.
 * @returns {{x: number, y: number}|null} The absolute screen coordinates for the click, or null if inputs are invalid.
 */
export function getAbsoluteGameWorldClickCoordinates(
  targetGameX,
  targetGameY,
  playerMinimapPosition,
  gameWorldRegion,
  tileSize,
  targetPoint = 'center',
) {
  // --- Input Validation ---
  if (!playerMinimapPosition) {
    console.error('[ClickTranslator] Missing playerMinimapPosition for coordinate translation.');
    return null;
  }
  if (!gameWorldRegion || !gameWorldRegion.width || !gameWorldRegion.height) {
    console.error('[ClickTranslator] Missing or invalid gameWorldRegion for coordinate translation.');
    return null;
  }
  if (!tileSize || !tileSize.width || !tileSize.height) {
    console.error('[ClickTranslator] Missing or invalid tileSize for coordinate translation.');
    return null;
  }

  // Calculate the difference in global game coordinates (in tiles)
  const deltaTilesX = targetGameX - playerMinimapPosition.x;
  const deltaTilesY = targetGameY - playerMinimapPosition.y;

  // Calculate the top-left pixel of the player's tile on screen using dynamic data
  const playerScreenPixelX_topLeft = gameWorldRegion.x + PLAYER_SCREEN_TILE_X * tileSize.width;
  const playerScreenPixelY_topLeft = gameWorldRegion.y + PLAYER_SCREEN_TILE_Y * tileSize.height;

  // Calculate the top-left pixel of the target tile on screen
  const targetTileScreenPixelX = playerScreenPixelX_topLeft + deltaTilesX * tileSize.width;
  const targetTileScreenPixelY = playerScreenPixelY_topLeft + deltaTilesY * tileSize.height;

  // Adjust based on targetPoint within the tile
  let finalClickX = targetTileScreenPixelX;
  let finalClickY = targetTileScreenPixelY;

  switch (targetPoint) {
    case 'topRight':
      finalClickX += tileSize.width;
      break;
    case 'bottomLeft':
      finalClickY += tileSize.height;
      break;
    case 'bottomRight':
      // Subtract a couple of pixels to ensure the click is inside the boundary
      finalClickX += tileSize.width - 2;
      finalClickY += tileSize.height - 2;
      break;
    case 'center':
    default: // Default to center for safety
      finalClickX += tileSize.width / 2;
      finalClickY += tileSize.height / 2;
      break;
  }

  // Return the final, rounded coordinates to ensure they are integers
  return { x: Math.round(finalClickX), y: Math.round(finalClickY) };
}
