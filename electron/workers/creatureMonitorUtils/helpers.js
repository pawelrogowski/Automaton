// Helpers for creatureMonitor
// ---------------------------
// This module contains small, well-named, non-abstracted helpers used by
// ["creatureMonitor.js"](electron/workers/creatureMonitor.js).
// Any new generic helpers for the creature monitor pipeline should live here
// (or in additional files in this folder) to keep the main worker focused.
// All helpers are arrow functions by convention.

/**
 * Compare a value (by JSON) against a cached entry and update the cache.
 * Returns true if the value is unchanged, false if it changed (and cache updated).
 */
export const jsonEqualsAndCache = (cache, key, value) => {
  const str = JSON.stringify(value);
  if (cache[key] === str) {
    return true;
  }
  cache[key] = str;
  return false;
};

/**
 * Returns true when two axis-aligned rectangles intersect.
 */
export const rectsIntersect = (a, b) => {
  if (!a || !b) return false;
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
};

/**
 * Returns true if any dirty rect intersects the given region.
 */
export const shouldRefreshRegionForDirtyRects = (region, dirtyRects) => {
  if (!region) return false;
  if (!Array.isArray(dirtyRects) || dirtyRects.length === 0) return false;
  for (let i = 0; i < dirtyRects.length; i += 1) {
    if (rectsIntersect(region, dirtyRects[i])) {
      return true;
    }
  }
  return false;
};

/**
 * Project a single health bar detection into tile coordinates.
 * Uses the supplied getGameCoordinatesFromScreenFn to avoid tight coupling.
 */
export const projectHealthBarToTileCoords = (
  hb,
  gameWorld,
  tileSize,
  playerPos,
  getGameCoordinatesFromScreenFn,
) => {
  if (!hb || !gameWorld || !tileSize || !getGameCoordinatesFromScreenFn) {
    return null;
  }
  if (typeof hb.x !== 'number' || typeof hb.y !== 'number') {
    return null;
  }

  const creatureScreenX = hb.x;
  const creatureScreenY = hb.y + 14 + tileSize.height / 2;

  const coords = getGameCoordinatesFromScreenFn(
    creatureScreenX,
    creatureScreenY,
    playerPos,
    gameWorld,
    tileSize,
  );
  if (!coords) {
    return null;
  }

  return {
    x: Math.round(coords.x),
    y: Math.round(coords.y),
    z: coords.z,
  };
};