// findSequence.js

import packColors from '../utils/packColors.js';
import { buildTrie, clearTrieNodes } from '../utils/trieUtils.js'; // Adjust the path as necessary

function findSequence(imageData, targetSequence, width, startCoordinates = null) {
  // Calculate the total number of pixels in the image.
  const length = imageData.length / 4;
  // Pack the image data into a more compact format for easier processing.
  let packedImageData = packColors(imageData);

  // Build the trie from the target sequence.
  const trie = buildTrie({ [targetSequence.name]: targetSequence });

  // Iterate over the image data to find the sequence.
  outer: for (let i = 0; i < length; i++) {
    let x = i % width;
    let y = Math.floor(i / width);

    // If startCoordinates is provided, skip iterations before the starting coordinates.
    if (startCoordinates && (x < startCoordinates.x || y < startCoordinates.y)) {
      continue;
    }

    let node = trie;
    let sequenceLength = 0;

    for (let j = i; j < length; j++) {
      const color = packedImageData[j];
      // If the current color is not in the trie, break the loop.
      if (!(color in node.children)) {
        break;
      }
      node = node.children[color];
      sequenceLength++;
      // If the sequence length exceeds the current node's sequence length, break the loop.
      if (sequenceLength > node.sequenceLength) {
        break;
      }
      // If the sequence length matches the current node's sequence length, check for matching sequences.
      if (sequenceLength === node.sequenceLength) {
        const { direction, offset } = node.sequences[0];
        let foundX, foundY;
        // Calculate the found position based on the direction and offset.
        if (direction === 'horizontal') {
          foundX = x + offset.x;
          foundY = y + offset.y;
        } else {
          foundX = x - offset.x;
          foundY = y - offset.y;
        }
        // Clear the packed image data and trie nodes to free up memory.
        packedImageData = null;
        clearTrieNodes(trie);
        // Return the found sequence's position.
        return { x: foundX, y: foundY };
      }
      // Update the x and y coordinates for the next iteration.
      x = (x + 1) % width;
      y = x === 0 ? y + 1 : y;
    }
  }
  // Clear the packed image data and trie nodes to free up memory.
  packedImageData = null;
  clearTrieNodes(trie);
  // Return an empty object if the sequence is not found.
  return {};
}

// Export the findSequence function.
export default findSequence;
