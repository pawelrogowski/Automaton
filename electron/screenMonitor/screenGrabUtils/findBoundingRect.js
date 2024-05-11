// findBoundingRect.js

// Import the findSequence function
import findSequence from './findSequence.js';

/**
 * Finds the bounding rectangle between two sequences in an image.
 * @param {Uint8ClampedArray} imageData - The image data to search within.
 * @param {Object} startPoint - The starting point coordinates.
 * @param {Object} sequence2 - The second sequence to find.
 * @param {number} imageWidth - The width of the image.
 * @param {number} maxSearchRight - The maximum number of pixels to search to the right from the starting point.
 * @param {number} maxSearchDown - The maximum number of pixels to search down from the starting point.
 * @returns {Object} - The bounding rectangle's dimensions and position.
 */
function findBoundingRect(
  imageData,
  startPoint,
  sequence2,
  imageWidth,
  maxSearchRight,
  maxSearchDown,
) {
  // Find the ending point of sequence2 within the limited search area.
  const limiter = { x: 150, y: Infinity };
  const endPoint = findSequence(imageData, sequence2, imageWidth, startPoint, limiter);
  if (!endPoint.x || !endPoint.y) {
    // If sequence2 is not found, return an empty object.
    return {};
  }
  console.log('startPoint:', startPoint);
  console.log(`Found sequence2 at coordinates: x=${endPoint.x}, y=${endPoint.y}`); // Log the coordinates of sequence2

  // Calculate the rectangle's dimensions.
  const rect = {
    x: startPoint.x,
    y: startPoint.y,
    width: endPoint.x - startPoint.x,
    height: endPoint.y - startPoint.y,
  };
  console.log(rect);
  // Return the rectangle's dimensions.
  return rect;
}

// Export the findBoundingRect function.
export default findBoundingRect;
