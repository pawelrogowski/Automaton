import getWindowGeometry from '../windowUtils/getWindowGeometry.js';

const findRegionsOfInterest = async (
  pixels,
  region,
  regionsOfInterest,
  windowId,
  returnWindowGeometry = true,
) => {
  let results = {};
  let sequencesToFind = Object.entries(regionsOfInterest).map(([key, sequence]) => ({
    key,
    sequence,
    currentSequence: [],
    foundSequence: false,
  }));

  while (true) {
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        const index = y * region.width + x;
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
            const position = { x: region.x + x - sequence.length + 1, y: region.y + y };
            const pixelColor = hex;
            const pixelsToLeft = [];
            for (let offset = 1; offset <= 3; offset++) {
              const pixelToLeftIndex = x - offset >= 0 ? y * region.width + (x - offset) : null;
              pixelsToLeft.unshift(pixelToLeftIndex !== null ? pixels[pixelToLeftIndex] : null); // unshift to add to the beginning
            }
            console.log(
              `Position: ${JSON.stringify(
                position,
              )}, Pixel Color: ${pixelColor}, Pixels to Left: ${pixelsToLeft.join(', ')}`,
            );
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

    if (sequencesToFind.length > 0 && returnWindowGeometry) {
      console.log(
        `${sequencesToFind
          .map(({ key }) => `${key}_NOT_FOUND: updating window position`)
          .join(', ')}`,
      );
      try {
        const windowGeometry = await getWindowGeometry(windowId);
        region = windowGeometry;
      } catch (error) {
        console.log(error);
        throw error;
      }
    } else {
      break;
    }
  }

  return results;
};

export default findRegionsOfInterest;
