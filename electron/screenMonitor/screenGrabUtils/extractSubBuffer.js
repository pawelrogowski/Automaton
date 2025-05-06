/**
 * Extracts a rectangular region from a source image buffer (RGB format with 8-byte header)
 * and returns it as a new buffer with its own 8-byte header.
 *
 * @param {Buffer} sourceImageDataWithHeader - The source Buffer containing [width (4b LE), height (4b LE), RGB data...].
 * @param {object} absoluteRect - The rectangle to extract, with absolute coordinates { x, y, width, height }.
 * @returns {Buffer} A new Buffer containing the extracted region and its 8-byte header.
 * @throws {Error} If inputs are invalid or extraction fails.
 */
export const extractSubBuffer = (sourceImageDataWithHeader, absoluteRect) => {
    // --- Input Validation ---
    if (!sourceImageDataWithHeader || !Buffer.isBuffer(sourceImageDataWithHeader) || sourceImageDataWithHeader.length < 8) {
        throw new Error('extractSubBuffer: Invalid source image buffer provided.');
    }
    if (!absoluteRect || typeof absoluteRect !== 'object' ||
        typeof absoluteRect.x !== 'number' || typeof absoluteRect.y !== 'number' ||
        typeof absoluteRect.width !== 'number' || typeof absoluteRect.height !== 'number') {
        throw new Error('extractSubBuffer: Invalid absoluteRect object provided.');
    }
    if (absoluteRect.width <= 0 || absoluteRect.height <= 0) {
        throw new Error(`extractSubBuffer: Rectangle dimensions must be positive (got ${absoluteRect.width}x${absoluteRect.height}).`);
    }
    if (absoluteRect.x < 0 || absoluteRect.y < 0) {
        throw new Error(`extractSubBuffer: Rectangle coordinates must be non-negative (got x=${absoluteRect.x}, y=${absoluteRect.y}).`);
    }

    // --- Read Source Header & Calculate Source Properties ---
    const sourceWidth = sourceImageDataWithHeader.readUInt32LE(0);
    const sourceHeight = sourceImageDataWithHeader.readUInt32LE(4);
    const bytesPerPixel = 3; // Assuming RGB format
    const sourceHeaderSize = 8;
    const sourceStride = sourceWidth * bytesPerPixel; // Bytes per row in source data
    const sourceDataLength = sourceImageDataWithHeader.length - sourceHeaderSize;

    // --- Validate Rectangle Bounds against Source Dimensions ---
    if (absoluteRect.x + absoluteRect.width > sourceWidth || absoluteRect.y + absoluteRect.height > sourceHeight) {
        throw new Error(`extractSubBuffer: Requested rectangle [${absoluteRect.x},${absoluteRect.y},${absoluteRect.width},${absoluteRect.height}] exceeds source dimensions [${sourceWidth}x${sourceHeight}].`);
    }

    // --- Calculate Output Buffer Size & Properties ---
    const outputWidth = absoluteRect.width;
    const outputHeight = absoluteRect.height;
    const outputHeaderSize = 8;
    const outputStride = outputWidth * bytesPerPixel; // Bytes per row in output data
    const outputDataSize = outputStride * outputHeight;
    const outputBufferSize = outputHeaderSize + outputDataSize;

    // --- Allocate Output Buffer ---
    const outputBuffer = Buffer.allocUnsafe(outputBufferSize); // Use allocUnsafe for potential performance gain

    // --- Write Output Header (Little Endian) ---
    outputBuffer.writeUInt32LE(outputWidth, 0);
    outputBuffer.writeUInt32LE(outputHeight, 4);

    // --- Copy Pixel Data Row by Row ---
    for (let y = 0; y < outputHeight; y++) {
        // Calculate source offset for the start of the current row within the rectangle
        const sourceRow = absoluteRect.y + y;
        const sourcePixelOffset = sourceRow * sourceWidth + absoluteRect.x; // Pixel offset from start of source image
        const sourceByteOffsetInData = sourcePixelOffset * bytesPerPixel; // Byte offset within source *data*
        const sourceAbsoluteByteOffset = sourceHeaderSize + sourceByteOffsetInData; // Absolute byte offset in source *buffer*

        // Calculate destination offset for the start of the current row in the output buffer
        const outputByteOffsetInData = y * outputStride; // Byte offset within output *data*
        const outputAbsoluteByteOffset = outputHeaderSize + outputByteOffsetInData; // Absolute byte offset in output *buffer*

        // Number of bytes to copy for this row
        const bytesToCopyThisRow = outputStride; // Same as outputStride

        // Perform the copy for the current row
        sourceImageDataWithHeader.copy(
            outputBuffer,               // Target buffer
            outputAbsoluteByteOffset,   // Target start offset
            sourceAbsoluteByteOffset,   // Source start offset
            sourceAbsoluteByteOffset + bytesToCopyThisRow // Source end offset (exclusive)
        );
    }

    // --- Return the New Buffer ---
    return outputBuffer;
}; 