import findSequences from './findSequences.js';

function findBoundingRect(imageData, startSequence, endSequence) {
  const sequences = findSequences(
    imageData,
    {
      start: startSequence,
      end: endSequence,
    },
    null,
    'first',
  );

  const startPoint = sequences.start;
  const endPoint = sequences.end;

  if (!startPoint.x || !startPoint.y || !endPoint.x || !endPoint.y) {
    return null;
  }

  const left = Math.min(startPoint.x, endPoint.x);
  const top = Math.min(startPoint.y, endPoint.y);
  const right = Math.max(startPoint.x, endPoint.x);
  const bottom = Math.max(startPoint.y, endPoint.y);

  const width = right - left + 1;
  const height = bottom - top + 1;

  return {
    x: left,
    y: top,
    width: width,
    height: height,
  };
}

export default findBoundingRect;
