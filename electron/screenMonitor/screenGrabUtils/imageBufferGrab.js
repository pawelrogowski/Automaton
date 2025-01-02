/**
 * Extracts a portion of an image buffer containing RGB data with dimensions header
 * @param {Buffer} buffer - Source buffer containing width and height header (8 bytes) followed by RGB data
 * @param {Object} params - Parameters for the region to extract
 * @param {number} params.x - X coordinate of the top-left corner
 * @param {number} params.y - Y coordinate of the top-left corner
 * @param {number} params.width - Width of the region to extract
 * @param {number} params.height - Height of the region to extract
 * @returns {Buffer} New buffer containing the extracted region with width and height header
 * @throws {Error} If requested dimensions are invalid or out of bounds
 */

export const imageBufferGrab = (buffer, { x, y, width, height }) => {
  // Read original dimensions from header
  const originalWidth = buffer.readInt32LE(0);
  const originalHeight = buffer.readInt32LE(4);

  // Validate requested dimensions
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > originalWidth || y + height > originalHeight) {
    throw new Error('Invalid dimensions for image grab');
  }

  // Calculate size for new buffer (RGB data + 8 byte header)
  const newBufferSize = width * height * 3 + 8;
  const newBuffer = Buffer.allocUnsafe(newBufferSize);

  // Write new dimensions to header
  newBuffer.writeInt32LE(width, 0);
  newBuffer.writeInt32LE(height, 4);

  // Copy data row by row
  for (let row = 0; row < height; row++) {
    const sourceStartIndex =
      8 + // Skip header
      ((y + row) * originalWidth + x) * 3; // Position in source
    const targetStartIndex =
      8 + // Skip header
      row * width * 3; // Position in target

    // Copy one row
    buffer.copy(
      newBuffer, // target buffer
      targetStartIndex, // target position
      sourceStartIndex, // source start
      sourceStartIndex + width * 3, // source end
    );
  }

  return newBuffer;
};

// Example usage:
/*
  const fullBuffer = capture.getImageData(windowId, buffer);
  try {
      // Get a 100x100 region starting at (50,50)
      const regionBuffer = imageBufferGrab(fullBuffer, { x: 50, y: 50, width: 100, height: 100 });
      // regionBuffer now contains: [width(4)][height(4)][RGB data(100x100x3)]
  } catch (err) {
      console.error('Failed to grab region:', err);
  }
  */
