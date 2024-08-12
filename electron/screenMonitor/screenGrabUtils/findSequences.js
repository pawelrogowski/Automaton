import packColors from '../utils/packColors.js';
import { buildTrie, clearTrieNodes } from '../utils/trieUtils.js';

function findSequences(imageData, targetSequences, width, searchArea = null, occurrence = 'first') {
  const length = imageData.length >> 2;
  const packedImageData = new Uint32Array(packColors(imageData));
  const foundSequences = Object.fromEntries(Object.keys(targetSequences).map((name) => [name, []]));

  const trie = buildTrie(targetSequences);
  const startIndex = searchArea ? searchArea.startIndex : 0;
  const endIndex = searchArea ? searchArea.endIndex : length;

  outer: for (let i = startIndex; i <= endIndex; i++) {
    let x = i % width;
    let y = Math.floor(i / width);
    let node = trie;
    let sequenceLength = 0;

    for (let j = i; j < length; j++) {
      const color = packedImageData[j];
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
          if (node.sequences.length > 0) {
            for (const { name, direction, offset } of node.sequences) {
              let foundX, foundY;
              if (direction === 'horizontal') {
                foundX = x + offset.x;
                foundY = y + offset.y;
              } else {
                foundX = x - offset.x;
                foundY = y - offset.y;
              }

              const existingSequence = foundSequences[name].find(
                (seq) => seq.x === foundX && seq.y === foundY,
              );
              if (!existingSequence) {
                foundSequences[name].push({ x: foundX, y: foundY });
                if (occurrence === 'first') {
                  if (Object.values(foundSequences).every((arr) => arr.length > 0)) {
                    break outer;
                  }
                }
              }
            }
          }
          sequenceLength = 0;
          node = trie;
        }
      } else {
        sequenceLength = 0;
        node = trie;
      }

      x = (j + 1) % width;
      y = x === 0 ? y + 1 : y;
    }
  }

  if (occurrence === 'first') {
    Object.keys(foundSequences).forEach((name) => {
      foundSequences[name] = foundSequences[name].length > 0 ? foundSequences[name][0] : {};
    });
  }

  clearTrieNodes(trie);
  return foundSequences;
}

export default findSequences;
