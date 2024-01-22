import getWindowGeometry from '../windowUtils/getWindowGeometry.js';

const findRegionsOfInterest = async (
  imageDataToProcess,
  rgbColorsToFind,
  windowId,
  returnWindowGeometry = true,
) => {
  try {
    let results = {};
    let sequencesToFind = Object.entries(rgbColorsToFind).map(([key, sequences]) => ({
      key,
      sequences,
      currentSequences: [],
      foundSequence: false,
    }));

    let currentRegion = await getWindowGeometry(windowId);

    for (let y = 0; y < currentRegion.height; y += 1) {
      for (let x = 0; x < currentRegion.width; x += 1) {
        const index = (y * currentRegion.width + x) * 4;
        const b = imageDataToProcess[index];
        const g = imageDataToProcess[index + 1];
        const r = imageDataToProcess[index + 2];
        const bgr = [b, g, r];

        for (let i = 0; i < sequencesToFind.length; i++) {
          let { key, sequences, currentSequences, foundSequence } = sequencesToFind[i];

          for (let j = 0; j < sequences.length; j++) {
            let sequence = sequences[j];

            if (
              currentSequences[j] &&
              JSON.stringify(bgr) === JSON.stringify(sequence[currentSequences[j].length])
            ) {
              currentSequences[j].push(bgr);
            } else {
              currentSequences[j] = [];
            }

            if (currentSequences[j].length === sequence.length) {
              foundSequence = true;
              const position = {
                x: currentRegion.x + x - sequence.length + 1,
                y: currentRegion.y + y,
              };

              results[key] = {
                found: true,
                position,
              };
              sequencesToFind.splice(i, 1); // remove this sequence from the list
              i--; // decrement i because we removed an element
              break;
            }
          }
        }
      }
    }

    // If sequences were not found, return 0 for each key
    if (Object.keys(results).length === 0) {
      sequencesToFind.forEach(({ key }) => {
        results[key] = {
          found: false,
          position: { x: 0, y: 0 },
        };
      });
    }

    return results;
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  }
};

export default findRegionsOfInterest;
