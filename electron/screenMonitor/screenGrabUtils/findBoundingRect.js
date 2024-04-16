import findSequence from './findSequence.js';

async function findBoundingRect(imageData, startSequence, endSequence, imageWidth) {
  const length = imageData.length / 4;
  const packedImageData = new Uint32Array(length);
  for (let i = 0; i < length; i++) {
    const index = i * 4;
    packedImageData[i] =
      (imageData[index + 2] << 16) | (imageData[index + 1] << 8) | imageData[index];
  }

  const packedStartSequence = startSequence.sequence
    ? startSequence.sequence.map(([r, g, b]) => (r << 16) | (g << 8) | b)
    : undefined;
  const packedEndSequence = endSequence.sequence
    ? endSequence.sequence.map(([r, g, b]) => (r << 16) | (g << 8) | b)
    : undefined;

  const startRegion = await findSequence(packedImageData, startSequence, imageWidth);
  if (!startRegion || startRegion.y === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const startIndex = startRegion.x * imageWidth + startRegion.y;
  const endSearchArea = {
    startIndex,
    endIndex: length - 1,
  };

  const endRegion = await findSequence(packedImageData, endSequence, imageWidth, endSearchArea, -1);
  if (!endRegion || endRegion.x === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const rectWidth = Math.abs(endRegion.x - startRegion.x);
  const rectHeight = Math.abs(endRegion.y - startRegion.y);
  return { x: startRegion.x, y: startRegion.y, width: rectWidth, height: rectHeight };
}

export default findBoundingRect;
