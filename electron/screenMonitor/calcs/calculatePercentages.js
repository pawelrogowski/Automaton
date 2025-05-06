/**
 * Calculates the percentage of matching pixels horizontally for a HP/Mana bar
 * within a larger image buffer. Assumes a fixed bar width of 94 pixels.
 *
 * @param {Buffer} fullImageDataBuffer - The FULL image buffer, including the 8-byte header.
 * @param {number} fullImageWidth - The width of the full image in pixels.
 * @param {object} containingRegion - The region {x, y, width, height} containing the bar (absolute coords).
 * @param {object} barRelativePos - The bar's start {x, y} relative to containingRegion's top-left.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @returns {number} The calculated percentage (0-100) or -1 on error.
 */
function calculatePercentages(fullImageDataBuffer, fullImageWidth, containingRegion, barRelativePos, validColors) {
  // --- Define the implicit bar width ---
  const BAR_PIXEL_WIDTH = 94;
  // ---

  try {
    // 1. Validate Inputs (barPixelWidth removed from check)
    if (!fullImageDataBuffer || fullImageDataBuffer.length < 8 || !containingRegion || !barRelativePos || !validColors) {
      console.error("calculatePercentages: Invalid arguments provided.");
      return -1;
    }
     if (fullImageWidth <= 0) {
        console.error("calculatePercentages: Invalid fullImageWidth.");
        return -1;
    }


    // 2. Get reference to RGB data (skip header)
    const rgbData = fullImageDataBuffer.subarray(8);
    const bytesPerPixel = 3;
    const fullImageStride = fullImageWidth * bytesPerPixel;

    // 3. Calculate Absolute Start Coordinates
    const absoluteBarStartX = containingRegion.x + barRelativePos.x;
    const absoluteBarStartY = containingRegion.y + barRelativePos.y;

    // 4. Calculate Start Byte Index in RGB data
    const startIndexBytes = (absoluteBarStartY * fullImageStride) + (absoluteBarStartX * bytesPerPixel);

    // 5. Bounds Check (using implicit BAR_PIXEL_WIDTH)
    const endIndexBytes = startIndexBytes + (BAR_PIXEL_WIDTH * bytesPerPixel);
    if (startIndexBytes < 0 || endIndexBytes > rgbData.length) {
        console.warn(`calculatePercentages: Calculated indices [${startIndexBytes}, ${endIndexBytes}) out of bounds for rgbData length ${rgbData.length}. Bar Pos: (${absoluteBarStartX},${absoluteBarStartY}), Width: ${BAR_PIXEL_WIDTH}`);
        return -1;
    }

    // 6. Prepare color set
    const colorSet = new Set(validColors.map((color) => color.join(',')));

    // 7. Count matching pixels (using implicit BAR_PIXEL_WIDTH)
    let matchingPixelsCount = 0;
    for (let i = 0; i < BAR_PIXEL_WIDTH; i++) {
        const currentPixelIndex = startIndexBytes + (i * bytesPerPixel);

        if (currentPixelIndex + 2 >= rgbData.length) { // Safety check inside loop
             console.warn(`calculatePercentages: Loop index ${currentPixelIndex} exceeds buffer bounds.`);
             break;
        }

        const r = rgbData[currentPixelIndex];
        const g = rgbData[currentPixelIndex + 1];
        const b = rgbData[currentPixelIndex + 2];

        if (colorSet.has(`${r},${g},${b}`)) {
            matchingPixelsCount++;
        }
    }

    // 8. Calculate percentage (using implicit BAR_PIXEL_WIDTH)
    const percentage = Math.round((matchingPixelsCount / BAR_PIXEL_WIDTH) * 100);
    return percentage;

  } catch (error) {
    console.error('Error in calculatePercentages:', error);
    return -1;
  }
}

export default calculatePercentages;