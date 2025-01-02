import { findSequences } from './findSequences.js';
import { imageBufferGrab } from './imageBufferGrab.js';

/**
 * Finds a bounding rectangle between two RGB sequences within specified bounds
 * @param {Buffer} imageData - Buffer containing image data with dimensions header (8 bytes) followed by RGB data
 * @param {Object} startSequence - RGB sequence to find the starting point
 * @param {Object} endSequence - RGB sequence to find the ending point within bounded area
 * @param {number} maxRight - Maximum pixels to search right from start sequence
 * @param {number} maxDown - Maximum pixels to search down from start sequence
 * @returns {Object} Bounding rectangle data
 * @property {number} x - X coordinate of the top-left corner
 * @property {number} y - Y coordinate of the top-left corner
 * @property {number} width - Width of the bounding rectangle
 * @property {number} height - Height of the bounding rectangle
 * @property {boolean} startFound - Whether the start sequence was found
 * @property {boolean} endFound - Whether the end sequence was found
 * @property {string} [error] - Error message if sequence(s) not found
 * @throws {Error} If input parameters are invalid
 * @throws {Error} If buffer dimensions are invalid
 * @throws {Error} If search area is invalid
 * @example
 * const rect = findBoundingRect(imageBuffer,
 *   { sequence1: [[255, 0, 0]] }, // red pixel
 *   { sequence2: [[0, 255, 0]] }, // green pixel
 *   100, // search 100px right
 *   50   // search 50px down
 * );
 */
export const findBoundingRect = (imageData, startSequence, endSequence, maxRight, maxDown) => {
  // Validate input parameters
  if (!imageData || !Buffer.isBuffer(imageData)) {
    throw new Error('Invalid or missing imageData buffer');
  }

  if (!startSequence || !endSequence) {
    throw new Error('Start and end sequences are required');
  }

  if (typeof maxRight !== 'number' || typeof maxDown !== 'number') {
    throw new Error('maxRight and maxDown must be numbers');
  }

  if (maxRight <= 0 || maxDown <= 0) {
    throw new Error('maxRight and maxDown must be positive values');
  }

  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);

  if (imageData.length < bufferWidth * bufferHeight * 3 + 8) {
    throw new Error('Buffer size does not match declared dimensions');
  }

  // Find start sequence
  const startResult = findSequences(imageData, { start: startSequence }, null, 'first');

  if (!startResult.start.x && !startResult.start.y) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      startFound: false,
      endFound: false,
      error: 'Start sequence not found in image',
    };
  }

  // Validate start sequence position
  if (startResult.start.x >= bufferWidth || startResult.start.y >= bufferHeight) {
    throw new Error('Start sequence found outside buffer dimensions');
  }

  // Calculate and validate search bounds
  const searchWidth = Math.min(maxRight, bufferWidth - startResult.start.x);
  const searchHeight = Math.min(maxDown, bufferHeight - startResult.start.y);

  if (searchWidth <= 0 || searchHeight <= 0) {
    return {
      x: startResult.start.x,
      y: startResult.start.y,
      width: 0,
      height: 0,
      startFound: true,
      endFound: false,
      error: 'Search area too small or out of bounds',
    };
  }

  try {
    // Extract bounded search area
    const boundedBuffer = imageBufferGrab(imageData, {
      x: startResult.start.x,
      y: startResult.start.y,
      width: searchWidth,
      height: searchHeight,
    });

    // Search for end sequence
    const endResult = findSequences(boundedBuffer, { end: endSequence }, null, 'first');

    if (!endResult.end.x && !endResult.end.y) {
      return {
        x: startResult.start.x,
        y: startResult.start.y,
        width: 0,
        height: 0,
        startFound: true,
        endFound: false,
        error: 'End sequence not found within search bounds',
      };
    }

    // Calculate and return rect dimensions
    return {
      x: startResult.start.x,
      y: startResult.start.y,
      width: endResult.end.x + 1,
      height: endResult.end.y + 1,
      startFound: true,
      endFound: true,
    };
  } catch (error) {
    throw new Error(`Failed to process search area: ${error.message}`);
  }
};
