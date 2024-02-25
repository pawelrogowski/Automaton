function findSequences(imageData, targetSequences, width, searchArea = null, occurrence = 'first') {
  return new Promise((resolve) => {
    const length = imageData.length / 4;
    const foundSequences = {};
    for (const [name, sequenceObj] of Object.entries(targetSequences)) {
      foundSequences[name] = {};

      // Adjust the loop to start from the search area if defined
      const startIndex = searchArea ? searchArea.startIndex : 0;
      const endIndex = searchArea ? searchArea.endIndex : length - sequenceObj.sequence.length;

      for (let i = startIndex; i <= endIndex; i += 1) {
        for (let j = 0; j < sequenceObj.sequence.length; j += 1) {
          let x;
          let y;
          if (sequenceObj.direction === 'vertical') {
            x = Math.floor((i + j) / width);
            y = (i + j) % width;
          } else {
            x = (i + j) % width;
            y = Math.floor((i + j) / width);
          }
          const index = (y * width + x) * 4;
          const currentColor = [imageData[index + 2], imageData[index + 1], imageData[index]];

          if (
            currentColor[0] !== sequenceObj.sequence[j][0] ||
            currentColor[1] !== sequenceObj.sequence[j][1] ||
            currentColor[2] !== sequenceObj.sequence[j][2]
          ) {
            break;
          }

          if (j === sequenceObj.sequence.length - 1) {
            // Apply the offset to the coordinates
            const offset = sequenceObj.offset || { x: 0, y: 0 };
            // Update the result based on the occurrence parameter
            if (
              occurrence === 'first' ||
              !foundSequences[name].x ||
              x + offset.x > foundSequences[name].x
            ) {
              foundSequences[name] = { x: x + offset.x, y: y + offset.y };
            }
            break;
          }
        }
      }
    }
    resolve(foundSequences);
  });
}

export default findSequences;
