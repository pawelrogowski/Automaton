// screenMonitor/calcs/calculatePartyHpPercentage.js

/**
 * Calculates the percentage of matching pixels in a party member's HP bar.
 * This is now a convenience wrapper around the main calculatePercentages function.
 *
 * @param {Buffer} fullFrameBuffer - The full-frame image buffer, including its 8-byte header.
 * @param {object} fullFrameMeta - Metadata object { width, height } for the full frame.
 * @param {object} barAbsoluteCoords - The bar's absolute start {x, y} within the window.
 * @param {Array<Array<number>>} validColors - Array of valid [R, G, B] color arrays for the bar.
 * @param {number} barPixelWidth - The width of the bar in pixels to analyze.
 * @returns {number} The calculated HP percentage (0-100) or -1 on error.
 */
import calculatePercentages from './calculatePercentages.js'; // Assuming it's in the same folder

function calculatePartyHpPercentage(fullFrameBuffer, fullFrameMeta, barAbsoluteCoords, validColors, barPixelWidth) {
  // This function now just calls the main, more generic percentage calculator.
  // This reduces code duplication.
  return calculatePercentages(fullFrameBuffer, fullFrameMeta, barAbsoluteCoords, validColors, barPixelWidth);
}

export default calculatePartyHpPercentage;
