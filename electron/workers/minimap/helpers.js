import { HEADER_SIZE, BYTES_PER_PIXEL } from './config.js';

/**
 * Checks if two rectangle objects intersect.
 * @returns {boolean} True if the rectangles overlap.
 */
export function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

/**
 * Extracts a rectangular region of raw BGRA pixel data from a larger buffer.
 * @param {Buffer} sourceBuffer - The full screen capture buffer.
 * @param {number} sourceWidth - The width of the full screen capture.
 * @param {object} rect - The {x, y, width, height} of the region to extract.
 * @returns {Buffer|null} A new Buffer containing the extracted region, or null on error.
 */
export function extractBGRA(sourceBuffer, sourceWidth, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const targetSize = rect.width * rect.height * BYTES_PER_PIXEL;
  const targetBuffer = Buffer.alloc(targetSize);

  for (let y = 0; y < rect.height; y++) {
    const sourceY = rect.y + y;
    const sourceRowStart =
      HEADER_SIZE + (sourceY * sourceWidth + rect.x) * BYTES_PER_PIXEL;
    const targetRowStart = y * rect.width * BYTES_PER_PIXEL;

    if (
      sourceRowStart < 0 ||
      sourceRowStart + rect.width * BYTES_PER_PIXEL > sourceBuffer.length
    ) {
      console.error('[MinimapHelpers] Buffer copy out of bounds.');
      return null;
    }

    sourceBuffer.copy(
      targetBuffer,
      targetRowStart,
      sourceRowStart,
      sourceRowStart + rect.width * BYTES_PER_PIXEL,
    );
  }

  return targetBuffer;
}
