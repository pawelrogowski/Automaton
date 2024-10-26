import { buildTrie, clearTrieNodes } from './trieUtils.js';

function findSequences(imageData, targetSequences, searchArea = null, occurrence = 'first') {
  // Extract dimensions from the buffer
  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);
  const rgbData = imageData.subarray(8);

  const length = rgbData.length / 3;
  const foundSequences = Object.fromEntries(Object.keys(targetSequences).map((name) => [name, []]));

  const trie = buildTrie(targetSequences);
  const startIndex = searchArea ? searchArea.startIndex : 0;
  const endIndex = searchArea ? searchArea.endIndex : length;

  outer: for (let i = startIndex; i < endIndex; i++) {
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

      x = (j + 1) % bufferWidth;
      y = x === 0 ? y + 1 : y;
    }
  }

  if (occurrence === 'first') {
    Object.keys(foundSequences).forEach((name) => {
      foundSequences[name] = foundSequences[name].length > 0 ? foundSequences[name][0] : {};
    });
  }

  clearTrieNodes(trie);
  // console.log(foundSequences);
  return foundSequences;
}

export default findSequences;
