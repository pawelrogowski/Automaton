async function findBoundingRect(imageData, startSequence, endSequence, width) {
  // Find the first occurrence of the start sequence
  const startRegions = await findSequencesInImageData(imageData, [startSequence], width);
  const startRegion = startRegions[startSequence.name];

  // If the start sequence is not found, return an empty result
  if (!startRegion || startRegion.y === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Define the search area for the end sequence based on the start sequence
  const endSearchArea = {
    startIndex: startRegion.x * width + startRegion.y,
    endIndex: width * width - 1, // Assuming the end sequence can be anywhere to the right and down from the start sequence
  };

  // Find the last occurrence of the end sequence within the defined search area
  const endRegions = await findSequencesInImageData(
    imageData,
    [endSequence],
    width,
    endSearchArea,
    'last',
  );
  const endRegion = endRegions[endSequence.name];

  // If the end sequence is not found, return an empty result
  if (!endRegion || endRegion.x === undefined) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Calculate the width and height based on the start and end sequences
  const width = Math.abs(endRegion.x - startRegion.x);
  const height = Math.abs(endRegion.y - startRegion.y);

  return { x: startRegion.x, y: startRegion.y, width, height };
}

export default findBoundingRect;
