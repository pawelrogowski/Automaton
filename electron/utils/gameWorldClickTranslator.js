// Player's fixed position on the screen within the game world window (0-indexed).
// This is a design constant representing the center of the viewport.
export const PLAYER_SCREEN_TILE_X = 7; // 8th tile from the left
export const PLAYER_SCREEN_TILE_Y = 5; // 6th tile from the top

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
    console.error(
      '[ClickTranslator] Missing playerMinimapPosition for coordinate translation.',
    );
    return null;
  }
  if (!gameWorldRegion || !gameWorldRegion.width || !gameWorldRegion.height) {
    console.error(
      '[ClickTranslator] Missing or invalid gameWorldRegion for coordinate translation.',
    );
    return null;
  }
  if (!tileSize || !tileSize.width || !tileSize.height) {
    console.error(
      '[ClickTranslator] Missing or invalid tileSize for coordinate translation.',
    );
    return null;
  }

  // Calculate the difference in global game coordinates (in tiles)
  const deltaTilesX = targetGameX - playerMinimapPosition.x;
  const deltaTilesY = targetGameY - playerMinimapPosition.y;

  // Calculate the top-left pixel of the player's tile on screen using dynamic data
  const playerScreenPixelX_topLeft =
    gameWorldRegion.x + PLAYER_SCREEN_TILE_X * tileSize.width;
  const playerScreenPixelY_topLeft =
    gameWorldRegion.y + PLAYER_SCREEN_TILE_Y * tileSize.height;

  // Calculate the top-left pixel of the target tile on screen
  const targetTileScreenPixelX =
    playerScreenPixelX_topLeft + deltaTilesX * tileSize.width;
  const targetTileScreenPixelY =
    playerScreenPixelY_topLeft + deltaTilesY * tileSize.height;

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

/**
 * Translates absolute screen coordinates to in-game world coordinates.
 *
 * @param {number} screenX - The absolute X coordinate on the screen.
 * @param {number} screenY - The absolute Y coordinate on the screen.
 * @param {{x: number, y: number, z: number}} playerMinimapPosition - The player's current absolute position.
 * @param {object} gameWorldRegion - The dynamically found gameWorld region object {x, y, width, height}.
 * @param {object} tileSize - The dynamically calculated tile size object {width, height}.
 * @returns {{x: number, y: number, z: number}|null} The absolute game world coordinates, or null if inputs are invalid.
 */
export function getGameCoordinatesFromScreen(
  screenX,
  screenY,
  playerMinimapPosition,
  gameWorldRegion,
  tileSize,
) {
  // --- Input Validation ---
  if (!playerMinimapPosition) {
    console.error(
      '[ClickTranslator] Missing playerMinimapPosition for coordinate translation.',
    );
    return null;
  }
  if (!gameWorldRegion || !gameWorldRegion.width || !gameWorldRegion.height) {
    console.error(
      '[ClickTranslator] Missing or invalid gameWorldRegion for coordinate translation.',
    );
    return null;
  }
  if (!tileSize || !tileSize.width || !tileSize.height) {
    console.error(
      '[ClickTranslator] Missing or invalid tileSize for coordinate translation.',
    );
    return null;
  }

  // --- Corrected Logic ---

  // 1. Calculate the entity's pixel position relative to the gameWorld region's origin.
  const relativeX = screenX - gameWorldRegion.x;
  const relativeY = screenY - gameWorldRegion.y;

  // 2. Convert the relative pixel position to a tile position within the gameWorld grid.
  const entityTileX = Math.floor(relativeX / tileSize.width);
  const entityTileY = Math.floor(relativeY / tileSize.height);

  // 3. Calculate the difference in tiles between the entity and the player's fixed screen position.
  const deltaTilesX = entityTileX - PLAYER_SCREEN_TILE_X;
  const deltaTilesY = entityTileY - PLAYER_SCREEN_TILE_Y;

  // 4. Add this tile difference to the player's absolute game world coordinates.
  const gameX = playerMinimapPosition.x + deltaTilesX;
  const gameY = playerMinimapPosition.y + deltaTilesY;

  return {
    x: gameX,
    y: gameY,
    z: playerMinimapPosition.z, // Z-level is the same as the player's
  };
}
