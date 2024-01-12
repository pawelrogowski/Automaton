import getWindowGeometry from '../windowUtils/getWindowGeometry.js';

const findRegionsOfInterest = async (
  pixels,
  regionsOfInterest,
  windowId,
  returnWindowGeometry = true,
) => {
  try {
    let results = {};
    let sequencesToFind = Object.entries(regionsOfInterest).map(([key, sequence]) => ({
      key,
      sequence,
      currentSequence: [],
      foundSequence: false,
    }));

    let currentRegion = await getWindowGeometry(windowId);

    for (let y = 0; y < currentRegion.height; y += 1) {
      for (let x = 0; x < currentRegion.width; x += 1) {
        const index = y * currentRegion.width + x;
        const hex = pixels[index];

        for (let i = 0; i < sequencesToFind.length; i++) {
          let { key, sequence, currentSequence, foundSequence } = sequencesToFind[i];

          if (hex === sequence[currentSequence.length]) {
            currentSequence.push(hex);
          } else {
            currentSequence = [];
          }

          if (currentSequence.length === sequence.length) {
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
