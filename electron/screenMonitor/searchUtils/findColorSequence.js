import getWindowGeometry from '../windowUtils/getWindowGeometry.js';

const findColorSequence = async (
  pixels,
  region,
  sequence,
  windowId,
  returnWindowGeometry = true,
) => {
  let currentSequence = [];
  let foundSequence = false;

  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = y * region.width + x;
      const hex = pixels[index];

      if (hex === sequence[currentSequence.length]) {
        currentSequence.push(hex);
      } else {
        currentSequence = [];
      }

      if (currentSequence.length === sequence.length) {
        foundSequence = true;
        return {
          found: true,
          position: { x: region.x + x - sequence.length + 1, y: region.y + y },
        };
      }
    }
  }

  if (returnWindowGeometry && !foundSequence) {
    console.log('SEQUENCE_NOT_FOUND: updating window position');
    try {
      const windowGeometry = await getWindowGeometry(windowId);
      region = windowGeometry;
      return findColorSequence(pixels, region, sequence, windowId, false);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  return {
    found: false,
  };
};

export default findColorSequence;
