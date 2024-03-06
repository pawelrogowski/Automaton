function findSequence(imageData, targetSequence, width, searchArea = null, occurrence = 0) {
  return new Promise((resolve) => {
    const length = imageData.length / 4;
    const foundSequences = [];

    // Adjust the loop to start from the search area if defined
    const startIndex = searchArea ? searchArea.startIndex : 0;
    const endIndex = searchArea ? searchArea.endIndex : length - targetSequence.sequence.length;

    for (let i = startIndex; i <= endIndex; i += 1) {
      for (let j = 0; j < targetSequence.sequence.length; j += 1) {
        let x;
        let y;
        if (targetSequence.direction === 'vertical') {
          x = Math.floor((i + j) / width);
          y = (i + j) % width;
        } else {
          x = (i + j) % width;
          y = Math.floor((i + j) / width);
        }
        const index = (y * width + x) * 4;
        const currentColor = [imageData[index + 2], imageData[index + 1], imageData[index]];

        if (
          currentColor[0] !== targetSequence.sequence[j][0] ||
          currentColor[1] !== targetSequence.sequence[j][1] ||
          currentColor[2] !== targetSequence.sequence[j][2]
        ) {
          break;
        }

        if (j === targetSequence.sequence.length - 1) {
          // Apply the offset to the coordinates
          const offset = targetSequence.offset || { x: 0, y: 0 };
          // Add the found sequence to the array
          foundSequences.push({ x: x + offset.x, y: y + offset.y });
          break;
        }
      }
    }

    // Determine the occurrence to return based on the occurrence parameter
    if (occurrence === 0) {
      // Return the first found sequence
      resolve(foundSequences[0] || { x: 0, y: 0 });
    } else if (occurrence === -1) {
      // Return the last found sequence
      resolve(foundSequences[foundSequences.length - 1] || { x: 0, y: 0 });
    } else {
      // Return the specified occurrence
      resolve(foundSequences[occurrence - 1] || { x: 0, y: 0 });
    }
  });
}

export default findSequence;
