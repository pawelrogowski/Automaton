/* eslint-disable no-restricted-syntax */
function findSequencesInImageData(imageData, targetSequences, width) {
  return new Promise((resolve, reject) => {
    const length = imageData.length / 4;
    const foundSequences = {};

    for (const [name, sequence] of Object.entries(targetSequences)) {
      foundSequences[name] = {};

      for (let i = 0; i <= length - sequence.length; i += 1) {
        for (let j = 0; j < sequence.length; j += 1) {
          const x = (i + j) % width;
          const y = Math.floor((i + j) / width);
          const index = (y * width + x) * 4;
          const currentColor = [imageData[index + 2], imageData[index + 1], imageData[index]];

          if (
            currentColor[0] !== sequence[j][0] ||
            currentColor[1] !== sequence[j][1] ||
            currentColor[2] !== sequence[j][2]
          ) {
            break;
          }

          if (j === sequence.length - 1) {
            foundSequences[name] = { x, y };
            break;
          }
        }

        if (Object.keys(foundSequences[name]).length > 0) {
          break;
        }
      }
    }

    // console.log(foundSequences);
    resolve(foundSequences);
  });
}

export default findSequencesInImageData;
