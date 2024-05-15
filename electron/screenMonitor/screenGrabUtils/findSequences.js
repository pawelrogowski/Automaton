// findSequences.js
// This function searches for sequences of colors within an image.
import packColors from '../utils/packColors.js';
import { buildTrie, clearTrieNodes } from '../utils/trieUtils.js'; // Adjust the path as necessary

function findSequences(imageData, targetSequences, width, searchArea = null, occurrence = 'first') {
  // Calculate the total number of pixels in the image.
  const length = imageData.length / 4;
  // Pack the image data into a more compact format for easier processing.
  let packedImageData = packColors(imageData);
  // Initialize an object to store found sequences, with each sequence's name as a key.
  const foundSequences = Object.fromEntries(Object.keys(targetSequences).map((name) => [name, []]));

  // Build the trie from the target sequences.
  const trie = buildTrie(targetSequences);
  // Determine the start and end indices for the search area.
  const startIndex = searchArea ? searchArea.startIndex : 0;
  const endIndex = searchArea ? searchArea.endIndex : length;

  // Iterate over the image data to find sequences.
  outer: for (let i = startIndex; i <= endIndex; i++) {
    let x = i % width;
    let y = Math.floor(i / width);
    let node = trie;
    let sequenceLength = 0;
    // Iterate over the image data starting from the current index.
    for (let j = i; j < length; j++) {
      const color = packedImageData[j];
      // If the current color is not in the trie's children and not "any", break the loop.
      if (!(color in node.children) && node.currentSequence[sequenceLength] !== 'any') {
        break;
      }
      // If the current color matches or the current sequence element is "any", move to the next node.
      if (color in node.children || node.currentSequence[sequenceLength] === 'any') {
        node = node.children[color] || node.children['any'];
        sequenceLength++;
        // If the sequence length exceeds the current node's sequence length, break the loop.
        if (sequenceLength > node.sequenceLength) {
          break;
        }
        // If the sequence length matches the current node's sequence length, check for matching sequences.
        if (sequenceLength === node.sequenceLength) {
          if (node.sequences.length > 0) {
            for (const { name, direction, offset } of node.sequences) {
              let foundX, foundY;
              // Calculate the found position based on the direction and offset.
              if (direction === 'horizontal') {
                foundX = x + offset.x;
                foundY = y + offset.y;
              } else {
                foundX = x - offset.x;
                foundY = y - offset.y;
              }
              // Check if the found sequence already exists.
              const existingSequence = foundSequences[name].find((seq) => {
                if (direction === 'horizontal') {
                  return seq.x === foundX && seq.y === foundY;
                } else {
                  return seq.x === foundX && seq.y === foundY;
                }
              });
              // If the sequence does not exist, add it to the found sequences.
              if (!existingSequence) {
                foundSequences[name].push({ x: foundX, y: foundY });
                // If the occurrence is 'first' and all sequences have been found, break the outer loop.
                if (occurrence === 'first') {
                  if (Object.values(foundSequences).every((arr) => arr.length > 0)) {
                    break outer;
                  }
                }
              }
            }
          }
          // Reset the sequence length for the next iteration.
          sequenceLength = 0;
        }
      } else {
        // If the current color does not match and the current sequence element is not "any", reset the sequence length.
        sequenceLength = 0;
      }
      // Update the x and y coordinates for the next iteration.
      x = (x + 1) % width;
      y = x === 0 ? y + 1 : y;
    }
  }

  // If the occurrence is 'first', return only the first found sequence for each name.
  if (occurrence === 'first') {
    Object.keys(foundSequences).forEach((name) => {
      foundSequences[name] = foundSequences[name].length > 0 ? foundSequences[name][0] : {};
    });
  }

  // Clear the packed image data to free up memory.
  packedImageData = null;

  // Clear the trie nodes to free up memory.
  clearTrieNodes(trie);
  // Return the found sequences.
  return foundSequences;
}

// Export the findSequences function.
export default findSequences;
