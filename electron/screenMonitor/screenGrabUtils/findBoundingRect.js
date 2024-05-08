// findBoundingRect.js

// Import the findSequence function
import findSequence from './findSequence.js';

/**
 * Finds the bounding rectangle between two sequences in an image.
 * @param {Uint8ClampedArray} imageData - The image data to search within.
 * @param {Object} sequence1 - The first sequence to find.
 * @param {Object} sequence2 - The second sequence to find.
 * @param {number} imageWidth - The width of the image.
 * @returns {Object} - The bounding rectangle's dimensions and position.
 */
function findBoundingRect(imageData, sequence1, sequence2, imageWidth) {
  // Find the starting point of sequence1.
  const startPoint = findSequence(imageData, sequence1, imageWidth);
  if (!startPoint.x || !startPoint.y) {
    // If sequence1 is not found, return an empty object.
    return {};
  }

  // Find the ending point of sequence2 starting from the coordinates of sequence1.
  const endPoint = findSequence(imageData, sequence2, imageWidth, {
    x: startPoint.x,
    y: startPoint.y,
  });
  if (!endPoint.x || !endPoint.y) {
    // If sequence2 is not found, return an empty object.
    return {};
  }

  // Calculate the rectangle's dimensions.
  const rect = {
    x: startPoint.x,
    y: startPoint.y,
    width: endPoint.x - startPoint.x,
    height: endPoint.y - startPoint.y,
  };

  // Return the rectangle's dimensions.
  return rect;
}

// Export the findBoundingRect function.
export default findBoundingRect;
