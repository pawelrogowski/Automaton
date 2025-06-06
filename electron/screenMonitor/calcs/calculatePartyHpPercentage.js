/**
 * Calculates the percentage of matching pixels in a party member's HP bar,
 * working directly with an image buffer (full or partial) and an index within that buffer.
 *
 * @param {Buffer} imageDataBuffer - The image buffer (full or partial), including the 8-byte header.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @param {number} barStartIndexBytes - The starting byte index of the bar within the `imageDataBuffer`
 *                                    (must account for the 8-byte header of this buffer).
 * @param {number} barPixelWidth - The width of the bar in pixels to analyze.
 * @returns {number} The calculated HP percentage (0-100) or -1 on error.
 */
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ info: true, error: true, warn: true });

function calculatePartyHpPercentage(imageDataBuffer, validColors, barStartIndexBytes, barPixelWidth) {
  try {
    // 1. Validate Inputs
    // Check if barStartIndexBytes is at least 8 (after header)
    if (!imageDataBuffer || imageDataBuffer.length < 8 || !validColors || barPixelWidth <= 0 || barStartIndexBytes < 8) {
      log(
        'error',
        `[calculatePartyHpPercentage] Invalid arguments. Index: ${barStartIndexBytes}, Width: ${barPixelWidth}, BufferLength: ${imageDataBuffer?.length}`,
      );
      return -1;
    }

    // {{change 1}} Add logging for inputs
    log(
      'info',
      `[calculatePartyHpPercentage] Inputs: BufferLength: ${imageDataBuffer.length}, StartIndexBytes: ${barStartIndexBytes}, BarWidth: ${barPixelWidth}`,
    );
    const bufferWidth = imageDataBuffer.readUInt32LE(0);
    const bufferHeight = imageDataBuffer.readUInt32LE(4);
    log('info', `[calculatePartyHpPercentage] Buffer Dims (from header): ${bufferWidth}x${bufferHeight}`);
    // {{end change 1}}

    const bytesPerPixel = 3;

    // 2. Calculate End Byte Index (Exclusive)
    // Based on the provided startIndexBytes and barPixelWidth within the provided buffer
    const endIndexBytes = barStartIndexBytes + barPixelWidth * bytesPerPixel;

    // 3. Bounds Check: Ensure the entire bar region is within the PROVIDED BUFFER
    if (endIndexBytes > imageDataBuffer.length) {
      log(
        'warn',
        `[calculatePartyHpPercentage] Calculated end index ${endIndexBytes} exceeds buffer length ${imageDataBuffer.length}. StartIndex: ${barStartIndexBytes}, Width: ${barPixelWidth}`,
      );
      return -1;
    }

    // 4. Prepare color set for quick lookup
    const colorSet = new Set(validColors.map((color) => color.join(',')));

    // 5. Count matching pixels along the bar's width
    let matchingPixelsCount = 0;
    // Loop directly using the provided start index and incrementing by bytesPerPixel
    for (let i = 0; i < barPixelWidth; i++) {
      const currentPixelStartIndex = barStartIndexBytes + i * bytesPerPixel;

      // Read RGB values directly from the provided buffer at the calculated index
      const r = imageDataBuffer[currentPixelStartIndex];
      const g = imageDataBuffer[currentPixelStartIndex + 1];
      const b = imageDataBuffer[currentPixelStartIndex + 2];

      // Check if the color matches one of the valid colors
      if (colorSet.has(`${r},${g},${b}`)) {
        matchingPixelsCount++;
      }
    }

    // 6. Calculate and return percentage
    const percentage = Math.round((matchingPixelsCount / barPixelWidth) * 100);

    // {{change 2}} Add logging for calculated percentage
    log(
      'info',
      `[calculatePartyHpPercentage] Calculated Percentage: ${percentage}% (Matching Pixels: ${matchingPixelsCount}, Total Width: ${barPixelWidth})`,
    );
    // {{end change 2}}

    return percentage;
  } catch (error) {
    // Log the specific error
    log('error', '[calculatePartyHpPercentage] Error in calculatePartyHpPercentage:', error);
    return -1; // Return -1 or throw, depending on desired error handling
  }
}

export default calculatePartyHpPercentage;
