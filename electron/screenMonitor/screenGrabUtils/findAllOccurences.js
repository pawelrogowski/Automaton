import { buildTrie, clearTrieNodes } from '../utils/trieUtils.js';

function findAllOccurrences(imageData, targetSequence) {
  // Extract dimensions from the buffer
  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);
  const rgbData = imageData.subarray(8);

  const length = rgbData.length / 3;
  const trie = buildTrie({ [targetSequence.name]: targetSequence });
  const occurrences = [];

  for (let i = 0; i < length; i++) {
    let x = i % bufferWidth;
    let y = Math.floor(i / bufferWidth);

    let node = trie;
    let sequenceLength = 0;

    for (let j = i; j < length; j++) {
      const pixelIndex = j * 3;
      const r = rgbData[pixelIndex];
      const g = rgbData[pixelIndex + 1];
      const b = rgbData[pixelIndex + 2];
      const color = (r << 16) | (g << 8) | b;

      if (!(color in node.children) && node.currentSequence[sequenceLength] !== 'any') {
        break;
      }

      if (color in node.children || node.currentSequence[sequenceLength] === 'any') {
        node = node.children[color] || node.children['any'];
        sequenceLength++;

        if (sequenceLength > node.sequenceLength) {
          break;
        }

        if (sequenceLength === node.sequenceLength) {
          const { direction, offset } = node.sequences[0];
          let foundX, foundY;
          if (direction === 'horizontal') {
            foundX = x + offset.x;
            foundY = y + offset.y;
          } else {
            foundX = x - offset.x;
            foundY = y - offset.y;
          }

          // Assuming the sequence is vertical and has a fixed height
          const occurrenceWidth = 1; // Since it's vertical, width is 1
          const occurrenceHeight = targetSequence.sequence.length; // Height is the length of the sequence

          // Check for overlap with existing occurrences
          const isOverlap = occurrences.some((occurrence) => {
            return (
              occurrence.x <= foundX &&
              foundX <= occurrence.x + occurrenceWidth &&
              occurrence.y <= foundY &&
              foundY <= occurrence.y + occurrenceHeight
            );
          });

          if (!isOverlap) {
            occurrences.push({
              x: foundX,
              y: foundY,
              width: occurrenceWidth,
              height: occurrenceHeight,
            });
          }

          sequenceLength = 0;
          node = trie;
        }
      } else {
        sequenceLength = 0;
        node = trie;
      }

      x = (j + 1) % bufferWidth;
      y = x === 0 ? y + 1 : y;
    }
  }

  clearTrieNodes(trie);
  return occurrences;
}

export default findAllOccurrences;
