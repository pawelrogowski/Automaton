// IMPORTANT: Assumes the existence of a function:
// extractSubBuffer(sourceImageDataWithHeader, absoluteRect {x, y, width, height})
// which returns a NEW Buffer containing the specified region's pixel data
// PREPENDED with a new 8-byte header (width, height in Little Endian).
// You will need to provide or implement this function.
import { extractSubBuffer } from './extractSubBuffer.js'; // Adjust path if needed

/**
 * Finds a bounding rectangle defined by start and end sequences,
 * replicating the old logic by extracting a sub-buffer for the end search.
 * @param {function} findSequencesNativeFunc - The loaded native findSequences function.
 * @param {Buffer} imageData - Full image data buffer including 8-byte header.
 * @param {object} startSequence - Config object for the start sequence.
 * @param {object} endSequence - Config object for the end sequence.
 * @param {number} maxRight - Max width to search rightwards from start.
 * @param {number} maxDown - Max height to search downwards from start.
 * @returns {object} Result object { x, y, width, height, startFound, endFound, error? }.
 */
export const findBoundingRect = (findSequencesNativeFunc, imageData, startSequence, endSequence, maxRight, maxDown) => {
  // --- Input Validation --- (Keep existing checks)
  if (typeof findSequencesNativeFunc !== 'function') throw new Error('findBoundingRect: findSequencesNativeFunc (first argument) must be a function.');
  if (typeof extractSubBuffer !== 'function') throw new Error('findBoundingRect: extractSubBuffer helper function is required and was not found.'); // Add check
  if (!imageData || !Buffer.isBuffer(imageData) || imageData.length < 8) throw new Error('findBoundingRect: Invalid imageData buffer');
  if (!startSequence || !endSequence) throw new Error('findBoundingRect: Start/end sequences required');
  if (typeof maxRight !== 'number' || typeof maxDown !== 'number') throw new Error('findBoundingRect: maxRight/maxDown must be numbers');
  if (maxRight <= 0 || maxDown <= 0) throw new Error('findBoundingRect: maxRight/maxDown must be positive');

  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);
  if (imageData.length < bufferWidth * bufferHeight * 3 + 8) console.warn(`findBoundingRect: Buffer size smaller than expected.`);

  // --- Find Start Sequence (in full image) ---
  const startResult = findSequencesNativeFunc(imageData, { start: startSequence }, null, "first");

  if (!startResult?.start) return { x: 0, y: 0, width: 0, height: 0, startFound: false, endFound: false, error: 'Start sequence not found' };
  const startX = startResult.start.x; const startY = startResult.start.y;
  if (startX >= bufferWidth || startY >= bufferHeight) return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: 'Start sequence outside buffer' };

  // --- Define the Search Area dimensions relative to start ---
  const searchWidth = Math.min(maxRight, bufferWidth - startX);
  const searchHeight = Math.min(maxDown, bufferHeight - startY);
  if (searchWidth <= 0 || searchHeight <= 0) return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: 'Search area zero size' };

  // --- Extract the Sub-Buffer for the end search ---
  let subBuffer = null;
  try {
    // Define the absolute rectangle to extract
    const extractionRect = { x: startX, y: startY, width: searchWidth, height: searchHeight };
    subBuffer = extractSubBuffer(imageData, extractionRect);
    if (!subBuffer || !Buffer.isBuffer(subBuffer) || subBuffer.length < 8) {
        throw new Error('extractSubBuffer returned invalid data');
    }
    // Optional: Verify header in subBuffer matches searchWidth/searchHeight
    const subWidth = subBuffer.readUInt32LE(0);
    const subHeight = subBuffer.readUInt32LE(4);
    if (subWidth !== searchWidth || subHeight !== searchHeight) {
        console.warn(`findBoundingRect: Sub-buffer dimensions (${subWidth}x${subHeight}) don't match requested extraction (${searchWidth}x${searchHeight}).`);
        // Potentially throw an error or try to proceed carefully
    }

  } catch (error) {
    console.error('findBoundingRect: Error extracting sub-buffer:', error);
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: `Failed to extract search area: ${error.message}` };
  }

  // --- Find End Sequence (searching ONLY within the extracted sub-buffer) ---
  // Pass null for searchArea as we're searching the entire subBuffer.
  const endResult = findSequencesNativeFunc(subBuffer, { end: endSequence }, null, "first");

  // Check if an end sequence was found within the sub-buffer
  if (!endResult?.end) {
    // console.warn(`findBoundingRect: End sequence not found in extracted sub-buffer.`); // Less verbose log
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: 'End sequence not found within search bounds (sub-buffer)' };
  }

  // Get the coordinates RELATIVE to the sub-buffer's top-left (0,0)
  const endX_rel = endResult.end.x;
  const endY_rel = endResult.end.y;

  // --- Calculate Final Bounding Rectangle ---
  // Width/height are based on the end sequence's position within the sub-buffer.
  const rectWidth = endX_rel + 1;
  const rectHeight = endY_rel + 1;

  // Validate relative coordinates and dimensions
  const subBufferWidth = subBuffer.readUInt32LE(0); // Read actual width from sub-buffer header
  const subBufferHeight = subBuffer.readUInt32LE(4); // Read actual height from sub-buffer header
  if (endX_rel < 0 || endX_rel >= subBufferWidth || endY_rel < 0 || endY_rel >= subBufferHeight) {
       console.warn(`findBoundingRect: Relative end coordinates (${endX_rel},${endY_rel}) are outside sub-buffer dimensions (${subBufferWidth}x${subBufferHeight}).`);
       // This likely indicates an issue with findSequencesNative or sub-buffer extraction
        return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: 'Internal error: End sequence found outside sub-buffer bounds' };
  }
  if (rectWidth <= 0 || rectHeight <= 0) {
    console.warn(`findBoundingRect: Calculated non-positive rect dims (w=${rectWidth}, h=${rectHeight}) from relative end coords (${endX_rel},${endY_rel}).`);
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: true, error: 'Non-positive rect dims calculated from relative coords' };
  }

  // Return the rectangle starting at the original absolute (startX, startY)
  // but with width/height determined by the relative search.
  return { x: startX, y: startY, width: rectWidth, height: rectHeight, startFound: true, endFound: true };
};