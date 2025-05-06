/**
 * Calculates the percentage of matching pixels in a party member's HP bar,
 * working directly with the full image buffer and an absolute start index.
 *
 * @param {Buffer} fullImageDataBuffer - The FULL image buffer, including the 8-byte header.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @param {number} absoluteStartIndexBytes - The absolute starting byte index of the bar within the fullImageDataBuffer (must account for header).
 * @param {number} barPixelWidth - The width of the bar in pixels to analyze.
 * @returns {number} The calculated HP percentage (0-100) or -1 on error.
 */
function calculatePartyHpPercentage(fullImageDataBuffer, validColors, absoluteStartIndexBytes, barPixelWidth) {
  try {
    // 1. Validate Inputs
    if (!fullImageDataBuffer || fullImageDataBuffer.length < 8 || !validColors || barPixelWidth <= 0 || absoluteStartIndexBytes < 8) { // Start index must be >= header size
      console.error(`calculatePartyHpPercentage: Invalid arguments. Index: ${absoluteStartIndexBytes}, Width: ${barPixelWidth}, BufferLength: ${fullImageDataBuffer?.length}`);
      return -1;
    }

    const bytesPerPixel = 3;

    // 2. Calculate End Byte Index (Exclusive)
    // It's the start index plus the total bytes the bar occupies (width * 3)
    const endIndexBytes = absoluteStartIndexBytes + (barPixelWidth * bytesPerPixel);

    // 3. Bounds Check: Ensure the entire bar region is within the buffer
    if (endIndexBytes > fullImageDataBuffer.length) {
      console.warn(`calculatePartyHpPercentage: Calculated end index ${endIndexBytes} exceeds buffer length ${fullImageDataBuffer.length}. StartIndex: ${absoluteStartIndexBytes}, Width: ${barPixelWidth}`);
      return -1;
    }

    // 4. Prepare color set for quick lookup
    const colorSet = new Set(validColors.map((color) => color.join(',')));

    // 5. Count matching pixels along the bar's width
    let matchingPixelsCount = 0;
    // Loop directly using the absolute start index and incrementing by bytesPerPixel
    for (let i = 0; i < barPixelWidth; i++) {
      const currentPixelStartIndex = absoluteStartIndexBytes + (i * bytesPerPixel);

      // Read RGB values directly from the full buffer at the calculated index
      // No need to add rgbDataStart (8) here, as absoluteStartIndexBytes already includes it.
      const r = fullImageDataBuffer[currentPixelStartIndex];
      const g = fullImageDataBuffer[currentPixelStartIndex + 1];
      const b = fullImageDataBuffer[currentPixelStartIndex + 2];

      // Check if the color matches one of the valid colors
      if (colorSet.has(`${r},${g},${b}`)) {
        matchingPixelsCount++;
      }
    }

    // 6. Calculate and return percentage
    const percentage = Math.round((matchingPixelsCount / barPixelWidth) * 100);
    return percentage;

  } catch (error) {
    // Log the specific error
    console.error('Error in calculatePartyHpPercentage:', error);
    return -1; // Return -1 or throw, depending on desired error handling
  }
}

export default calculatePartyHpPercentage;