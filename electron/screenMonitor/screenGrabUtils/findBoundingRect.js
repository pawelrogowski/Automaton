import findSequence from './findSequence.js'; // Adjust the import path as necessary

async function findBoundingRect(imageData, startSequence, endSequence, imageWidth) {
  const length = imageData.length / 4;
  const packedImageData = new Uint32Array(length);
  for (let i = 0; i < length; i++) {
    const index = i * 4;
    packedImageData[i] =
      (imageData[index + 2] << 16) | (imageData[index + 1] << 8) | imageData[index];
  }

  const startRegion = await findSequence(packedImageData, startSequence, imageWidth);
  if (!startRegion || startRegion.y === undefined) {
    console.error('Start region not found');
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const startIndex = startRegion.x * imageWidth + startRegion.y;
  const endSearchArea = {
    startIndex,
    endIndex: length - 1,
  };

  const endRegion = await findSequence(packedImageData, endSequence, imageWidth, endSearchArea, -1);
  if (!endRegion || endRegion.x === undefined) {
    console.error('End region not found');
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Ensure the top-left corner is correctly identified
  const topLeftX = Math.min(startRegion.x, endRegion.x);
  const topLeftY = Math.min(startRegion.y, endRegion.y);

  const rectWidth = Math.abs(endRegion.x - startRegion.x);
  const rectHeight = Math.abs(endRegion.y - startRegion.y);

  console.log('Start Region:', startRegion);
  console.log('End Region:', endRegion);
  console.log('Bounding Rectangle:', {
    x: topLeftX,
    y: topLeftY,
    width: rectWidth,
    height: rectHeight,
  });

  return { x: topLeftX, y: topLeftY, width: rectWidth, height: rectHeight };
}

export default findBoundingRect;
