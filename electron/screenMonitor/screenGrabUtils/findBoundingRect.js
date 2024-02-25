import findSequence from './findSequence.js';

async function findBoundingRect(imageData, startSequence, endSequence, imageWidth) {
  // Find the first occurrence of the start sequence
  const startRegion = await findSequence(imageData, startSequence, imageWidth);

  // If the start sequence is not found, return an empty result
  if (!startRegion || startRegion.y === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Define the search area for the end sequence based on the start sequence
  const endSearchArea = {
    startIndex: startRegion.x * imageWidth + startRegion.y,
    endIndex: imageWidth * imageWidth - 1, // Assuming the end sequence can be anywhere to the right and down from the start sequence
  };

  // Find the last occurrence of the end sequence within the defined search area
  const endRegion = await findSequence(imageData, endSequence, imageWidth, endSearchArea, -1);

  // If the end sequence is not found, return an empty result
  if (!endRegion || endRegion.x === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Calculate the width and height based on the start and end sequences
  const rectWidth = Math.abs(endRegion.x - startRegion.x);
  const rectHeight = Math.abs(endRegion.y - startRegion.y);

  return { x: startRegion.x, y: startRegion.y, width: rectWidth, height: rectHeight };
}
export default findBoundingRect;
