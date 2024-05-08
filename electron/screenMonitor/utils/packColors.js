// Helper function to pack an entire image's RGB values into a single integer array.
function packColors(imageData) {
  // Calculate the total number of pixels in the image.
  const length = imageData.length / 4;
  // Initialize an array to hold the packed colors.
  const packedImageData = new Array(length);

  for (let i = 0; i < length; i++) {
    const index = i * 4;
    // Pack each pixel's RGB values into a single integer.
    packedImageData[i] = packColor(imageData[index + 2], imageData[index + 1], imageData[index]);
  }

  return packedImageData;
}

// Helper function to pack RGB values into a single integer.
function packColor(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

// Export the packColors function.
export default packColors;
