import getWindowGeometry from '../windowUtils/getWindowGeometry.js';

const findColorSequence = (pixels, region, sequence, windowId, returnWindowGeometry = true) => {
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

  if (returnWindowGeometry) {
    console.log('WINDOW_FULL_SCAN');
    const windowGeometry = getWindowGeometry(windowId);
    return {
      found: false,
      position: windowGeometry,
    };
  }

  return {
    found: false,
  };
};

export default findColorSequence;
