/**
 * Checks if two rectangle objects intersect.
 * @param {object} rectA - The first rectangle {x, y, width, height}.
 * @param {object} rectB - The second rectangle {x, y, width, height}.
 * @returns {boolean} True if the rectangles overlap.
 */
export const rectsIntersect = (rectA, rectB) => {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}