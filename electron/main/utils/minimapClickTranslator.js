const MINIMAP_WIDTH = 106; // From preprocessMinimaps.js
const MINIMAP_HEIGHT = 109; // From preprocessMinimaps.js

/**
 * Translates global minimap coordinates to absolute screen coordinates for clicking.
 * @param {number} targetMapX - The target X coordinate on the global minimap.
 * @param {number} targetMapY - The target Y coordinate on the global minimap.
 * @param {{x: number, y: number, z: number}} playerMinimapPosition - The player's current position on the global minimap.
 * @param {{x: number, y: number, width: number, height: number}} minimapRegionDef - The screen coordinates and dimensions of the visible minimap.
 * @returns {{x: number, y: number}|null} The absolute screen coordinates for the click, or null if inputs are invalid.
 */
export function getAbsoluteClickCoordinates(
  targetMapX,
  targetMapY,
  playerMinimapPosition,
  minimapRegionDef,
) {
  if (!playerMinimapPosition || !minimapRegionDef) {
    console.error(
      'Missing playerMinimapPosition or minimapRegionDef for coordinate translation.',
    );
    return null;
  }

  // Calculate relative pixel position on the visible minimap
  const relativePixelX =
    targetMapX - playerMinimapPosition.x + MINIMAP_WIDTH / 2;
  const relativePixelY =
    targetMapY - playerMinimapPosition.y + MINIMAP_HEIGHT / 2;

  // Calculate absolute screen coordinates
  const absoluteClickX = minimapRegionDef.x + relativePixelX;
  const absoluteClickY = minimapRegionDef.y + relativePixelY;

  return { x: absoluteClickX, y: absoluteClickY };
}
