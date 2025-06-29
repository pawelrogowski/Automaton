// screenMonitor/calcs/calculatePercentages.js

/**
 * Calculates the percentage of matching pixels horizontally for a bar (like HP/Mana)
 * at a specific ABSOLUTE position within the full-frame image buffer.
 *
 * @param {Buffer} fullFrameBuffer - The full-frame image buffer, including its 8-byte header.
 * @param {object} fullFrameMeta - Metadata object { width, height } for the full frame.
 * @param {object} barAbsoluteCoords - The bar's absolute start {x, y} within the window.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @param {number} barPixelWidth - The width of the bar in pixels to analyze.
 * @returns {number} The calculated percentage (0-100) or -1 on error.
 */
function calculatePercentages(fullFrameBuffer, fullFrameMeta, barAbsoluteCoords, validColors, barPixelWidth) {
  try {
    // 1. Validate Inputs
    if (!fullFrameBuffer || fullFrameBuffer.length < 8 || !fullFrameMeta || !barAbsoluteCoords || !validColors || barPixelWidth <= 0) {
      return -1;
    }

    const { width: imageWidth, height: imageHeight } = fullFrameMeta;

    if (imageWidth <= 0 || imageHeight <= 0) {
      return -1;
    }

    // 2. Constants for BGRA format
    const bytesPerPixel = 4; // BGRA format
    const headerSize = 8;
    const imageStride = imageWidth * bytesPerPixel;

    // 3. Calculate Start Byte Index in the full buffer
    const { x: absoluteBarStartX, y: absoluteBarStartY } = barAbsoluteCoords;

    // Ensure coordinates are within the buffer dimensions
    if (absoluteBarStartX < 0 || absoluteBarStartX >= imageWidth || absoluteBarStartY < 0 || absoluteBarStartY >= imageHeight) {
      return -1;
    }

    const startIndexBytes = headerSize + absoluteBarStartY * imageStride + absoluteBarStartX * bytesPerPixel;

    // 4. Bounds Check
    const endIndexBytes = startIndexBytes + barPixelWidth * bytesPerPixel;
    if (absoluteBarStartX + barPixelWidth > imageWidth || startIndexBytes < headerSize || endIndexBytes > fullFrameBuffer.length) {
      return -1;
    }

    // 5. Prepare color set for quick lookup
    const colorSet = new Set(validColors.map((color) => color.join(',')));

    // 6. Count matching pixels
    let matchingPixelsCount = 0;
    for (let i = 0; i < barPixelWidth; i++) {
      const currentPixelIndex = startIndexBytes + i * bytesPerPixel;

      // Read BGRA, but we only care about RGB for comparison
      // B = index + 0, G = index + 1, R = index + 2
      const r = fullFrameBuffer[currentPixelIndex + 2];
      const g = fullFrameBuffer[currentPixelIndex + 1];
      const b = fullFrameBuffer[currentPixelIndex];

      if (colorSet.has(`${r},${g},${b}`)) {
        matchingPixelsCount++;
      }
    }

    if (barPixelWidth === 0) return 0;
    return Math.round((matchingPixelsCount / barPixelWidth) * 100);
  } catch (error) {
    console.error('Error in calculatePercentages:', error);
    return -1;
  }
}

export default calculatePercentages;
