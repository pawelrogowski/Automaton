// screenMonitor/screenGrabUtils/findBoundingRect.js

/**
 * Finds a bounding rectangle defined by start and end sequences using the new batch-based
 * native search function.
 *
 * @param {function} findSequencesNativeBatchFunc - The native findSequencesNativeBatch function.
 * @param {Buffer} fullFrameBuffer - Full image data buffer including 8-byte header.
 * @param {object} startSequenceConfig - Config object for the start sequence.
 * @param {object} endSequenceConfig - Config object for the end sequence.
 * @param {number} maxRight - Max width to search rightwards from start.
 * @param {number} maxDown - Max height to search downwards from start.
 * @returns {object} Result object { x, y, width, height, startFound, endFound, error? }.
 */
export const findBoundingRect = (
  findSequencesNativeBatchFunc,
  fullFrameBuffer,
  startSequenceConfig,
  endSequenceConfig,
  maxRight,
  maxDown,
) => {
  // --- Input Validation ---
  if (typeof findSequencesNativeBatchFunc !== 'function') throw new Error('findBoundingRect: findSequencesNativeBatchFunc is required.');
  if (!fullFrameBuffer || !Buffer.isBuffer(fullFrameBuffer) || fullFrameBuffer.length < 8)
    throw new Error('findBoundingRect: Invalid imageData buffer');
  if (!startSequenceConfig || !endSequenceConfig) throw new Error('findBoundingRect: Start/end sequence configs required');

  const bufferWidth = fullFrameBuffer.readUInt32LE(0);
  const bufferHeight = fullFrameBuffer.readUInt32LE(4);
  const fullSearchArea = { x: 0, y: 0, width: bufferWidth, height: bufferHeight };

  // --- Pass 1: Find the Start Sequence using the BATCH API ---
  const startResult = findSequencesNativeBatchFunc(fullFrameBuffer, {
    // Define a single task for this search
    startTask: {
      sequences: { start: startSequenceConfig }, // The sequence to find
      searchArea: fullSearchArea, // Search the whole screen
      occurrence: 'first',
    },
  });

  // The result is nested. We need to check startResult.startTask.start
  if (!startResult?.startTask?.start) {
    return { x: 0, y: 0, width: 0, height: 0, startFound: false, endFound: false, error: 'Start sequence not found' };
  }
  const { x: startX, y: startY } = startResult.startTask.start;

  // --- Define the Search Area for the second pass ---
  const endSearchArea = {
    x: startX,
    y: startY,
    width: Math.min(maxRight, bufferWidth - startX),
    height: Math.min(maxDown, bufferHeight - startY),
  };

  if (endSearchArea.width <= 0 || endSearchArea.height <= 0) {
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: false, error: 'Search area has zero size' };
  }

  // --- Pass 2: Find the End Sequence using the BATCH API ---
  const endResult = findSequencesNativeBatchFunc(fullFrameBuffer, {
    // Define a single task for the end search
    endTask: {
      sequences: { end: endSequenceConfig },
      searchArea: endSearchArea, // Search only in the smaller area
      occurrence: 'first',
    },
  });

  if (!endResult?.endTask?.end) {
    return {
      x: startX,
      y: startY,
      width: 0,
      height: 0,
      startFound: true,
      endFound: false,
      error: 'End sequence not found within search bounds',
    };
  }

  const { x: endX, y: endY } = endResult.endTask.end;

  // --- Calculate Final Bounding Rectangle ---
  const rectWidth = endX - startX + 1;
  const rectHeight = endY - startY + 1;

  if (rectWidth <= 0 || rectHeight <= 0) {
    return { x: startX, y: startY, width: 0, height: 0, startFound: true, endFound: true, error: 'Non-positive rect dims calculated' };
  }

  return { x: startX, y: startY, width: rectWidth, height: rectHeight, startFound: true, endFound: true };
};
