/**
 * Calculates the percentage of matching pixels horizontally for a bar (like HP/Mana)
 * at a specific position within a provided image buffer (full or partial).
 * Assumes a fixed bar width of 94 pixels unless overridden by a specific config.
 *
 * @param {Buffer} imageDataBuffer - The image buffer (full or partial), including the 8-byte header.
 * @param {object} barAbsolutePosInBuffer - The bar's start {x, y}, RELATIVE to the top-left (0,0) of the `imageDataBuffer`.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @param {number} [barPixelWidth=94] - Optional: The width of the bar in pixels to analyze. Defaults to 94.
 * @returns {number} The calculated percentage (0-100) or -1 on error.
 */
function calculatePercentages(imageDataBuffer, barAbsolutePosInBuffer, validColors, barPixelWidth = 94) {
  // --- Define the implicit bar width (or use provided) ---
  const BAR_PIXEL_WIDTH = barPixelWidth;
  // ---

  try {
    // 1. Validate Inputs
    if (!imageDataBuffer || imageDataBuffer.length < 8 || !barAbsolutePosInBuffer || !validColors || barPixelWidth <= 0) {
      console.error('calculatePercentages: Invalid arguments provided.');
      return -1;
    }

    // Read width and height from the buffer header itself
    const imageWidth = imageDataBuffer.readUInt32LE(0);
    const imageHeight = imageDataBuffer.readUInt32LE(4);

    if (imageWidth <= 0 || imageHeight <= 0 || imageDataBuffer.length < imageWidth * imageHeight * 3 + 8) {
      // Added buffer size check
      console.error(
        `calculatePercentages: Invalid image dimensions read from buffer header: ${imageWidth}x${imageHeight} or buffer length mismatch.`,
      );
      return -1;
    }

    // 2. Get reference to RGB data (skip header)
    const rgbData = imageDataBuffer.subarray(8);
    const bytesPerPixel = 3;
    // Use imageWidth (the width of the provided buffer) for stride
    const imageStride = imageWidth * bytesPerPixel;

    // 3. Calculate Start Byte Index in RGB data
    // barAbsolutePosInBuffer is expected to be relative to this buffer's (0,0)
    const absoluteBarStartX = barAbsolutePosInBuffer.x;
    const absoluteBarStartY = barAbsolutePosInBuffer.y;

    // Ensure coordinates are within the buffer dimensions
    if (absoluteBarStartX < 0 || absoluteBarStartX >= imageWidth || absoluteBarStartY < 0 || absoluteBarStartY >= imageHeight) {
      console.warn(
        `calculatePercentages: Bar start coordinates (${absoluteBarStartX},${absoluteBarStartY}) are outside buffer dimensions (${imageWidth}x${imageHeight}).`,
      );
      return -1;
    }

    // Calculate Start Byte Index in RGB data (relative to the start of rgbData subarray)
    // This index is calculated based on coordinates relative to the PROVIDED BUFFER's (0,0)
    const startIndexBytes = absoluteBarStartY * imageStride + absoluteBarStartX * bytesPerPixel;

    // 5. Bounds Check (using implicit BAR_PIXEL_WIDTH)
    const endIndexBytes = startIndexBytes + BAR_PIXEL_WIDTH * bytesPerPixel;
    // Check if the bar extends beyond the right edge of the image or past the end of the buffer
    if (
      absoluteBarStartX + BAR_PIXEL_WIDTH > imageWidth ||
      startIndexBytes < 0 ||
      startIndexBytes >= rgbData.length ||
      endIndexBytes > rgbData.length
    ) {
      console.warn(
        `calculatePercentages: Calculated indices [${startIndexBytes}, ${endIndexBytes}) or bar width (${BAR_PIXEL_WIDTH}) out of bounds for rgbData length ${rgbData.length} and image width ${imageWidth}. Bar Pos: (${absoluteBarStartX},${absoluteBarStartY})`,
      );
      return -1;
    }

    // 6. Prepare color set
    const colorSet = new Set(validColors.map((color) => color.join(',')));

    // 7. Count matching pixels (using BAR_PIXEL_WIDTH)
    let matchingPixelsCount = 0;
    for (let i = 0; i < BAR_PIXEL_WIDTH; i++) {
      const currentPixelIndex = startIndexBytes + i * bytesPerPixel;

      // Safety check inside loop (should be covered by bounds check, but extra safety)
      if (currentPixelIndex + 2 >= rgbData.length) {
        console.warn(`calculatePercentages: Loop index ${currentPixelIndex} exceeds buffer bounds unexpectedly.`);
        break; // Stop processing if we hit invalid memory
      }

      const r = rgbData[currentPixelIndex];
      const g = rgbData[currentPixelIndex + 1];
      const b = rgbData[currentPixelIndex + 2];

      if (colorSet.has(`${r},${g},${b}`)) {
        matchingPixelsCount++;
      }
    }

    if (BAR_PIXEL_WIDTH === 0) return 0;
    const percentage = Math.round((matchingPixelsCount / BAR_PIXEL_WIDTH) * 100);

    return percentage;
  } catch (error) {
    console.error('Error in calculatePercentages:', error);
    return -1;
  }
}

export default calculatePercentages;
