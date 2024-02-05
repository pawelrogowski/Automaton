function findSequencesInImageData(imageData, targetSequences, width) {
  return new Promise((resolve) => {
    const length = imageData.length / 4;
    const foundSequences = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const [name, sequenceObj] of Object.entries(targetSequences)) {
      foundSequences[name] = {};

      for (let i = 0; i <= length - sequenceObj.sequence.length; i += 1) {
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
            foundSequences[name] = { x, y };
            break;
          }
        }

        if (Object.keys(foundSequences[name]).length > 0) {
          break;
        }
      }
    }

    resolve(foundSequences);
  });
}

export default findSequencesInImageData;
