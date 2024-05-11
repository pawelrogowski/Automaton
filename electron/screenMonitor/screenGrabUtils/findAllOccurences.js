import packColors from '../utils/packColors.js';
import { buildTrie, clearTrieNodes } from '../utils/trieUtils.js';

function findAllOccurrences(imageData, targetSequence, width) {
  const length = imageData.length / 4;
  let packedImageData = packColors(imageData);
  const trie = buildTrie({ [targetSequence.name]: targetSequence });
  const occurrences = [];

  for (let i = 0; i < length; i++) {
    let x = i % width;
    let y = Math.floor(i / width);

    let node = trie;
    let sequenceLength = 0;

    for (let j = i; j < length; j++) {
      const color = packedImageData[j];
      if (!(color in node.children)) {
        break;
      }
      node = node.children[color];
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
      }
      x = (x + 1) % width;
      y = x === 0 ? y + 1 : y;
    }
  }

  packedImageData = null;
  clearTrieNodes(trie);
  return occurrences.length;
}

export default findAllOccurrences;
