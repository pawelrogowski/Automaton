/**
 * Finds a bounding rectangle between two sequences in an image, with optional search area limitations.
 * The function first locates the startSequence, then searches for the endSequence within optional bounds
 * relative to the start position.
 *
 * @param {ImageData} imageData - The image data to search in
 * @param {Array|String} startSequence - The sequence to find as the starting point
 * @param {Array|String} endSequence - The sequence to find as the ending point
 * @param {number} [maxRight=Infinity] - Maximum pixels to search right from the start sequence
 * @param {number} [maxDown=Infinity] - Maximum pixels to search down from the start sequence
 * @returns {Object|null} Returns an object containing the bounding rectangle coordinates and dimensions,
 *                        or null if either sequence is not found
 * @property {number} x - The left coordinate of the bounding rectangle
 * @property {number} y - The top coordinate of the bounding rectangle
 * @property {number} width - The width of the bounding rectangle
 * @property {number} height - The height of the bounding rectangle
 *
 * @example
 * // Search whole area
 * const rect = findBoundingRect(imageData, startSequence, endSequence);
 *
 * @example
 * // Search with limits
 * const rect = findBoundingRect(imageData, startSequence, endSequence, 200, 1000);
 */
import findSequences from './findSequences.js';

function findBoundingRect(
  imageData,
  startSequence,
  endSequence,
  maxRight = Infinity,
  maxDown = Infinity,
) {
  // First find the start sequence
  const startOnly = findSequences(
    imageData,
    {
      start: startSequence,
    },
    null,
    'first',
  );

  if (!startOnly.start || !startOnly.start.x || !startOnly.start.y) {
    return null;
  }

  // Create a limited search area based on the start position
  const searchArea =
    maxRight === Infinity && maxDown === Infinity
      ? null
      : {
          x: startOnly.start.x,
          y: startOnly.start.y,
          width: Math.min(
            maxRight === Infinity ? imageData.width - startOnly.start.x : maxRight,
            imageData.width - startOnly.start.x,
          ),
          height: Math.min(
            maxDown === Infinity ? imageData.height - startOnly.start.y : maxDown,
            imageData.height - startOnly.start.y,
          ),
        };

  // Find end sequence within the limited search area
  const sequences = findSequences(
    imageData,
    {
      start: startSequence,
      end: endSequence,
    },
    searchArea,
    'first',
  );

  const startPoint = sequences.start;
  const endPoint = sequences.end;

  if (!startPoint.x || !startPoint.y || !endPoint.x || !endPoint.y) {
    return null;
  }

  const left = Math.min(startPoint.x, endPoint.x);
  const top = Math.min(startPoint.y, endPoint.y);
  const right = Math.max(startPoint.x, endPoint.x);
  const bottom = Math.max(startPoint.y, endPoint.y);

  const width = right - left + 1;
  const height = bottom - top + 1;

  return {
    x: left,
    y: top,
    width: width,
    height: height,
  };
}

export default findBoundingRect;
