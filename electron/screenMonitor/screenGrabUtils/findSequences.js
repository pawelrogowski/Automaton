function findSequences(imageData, targetSequences, width, searchArea = null, occurrence = 'first') {
  const length = imageData.length / 4;
  const packedImageData = new Uint32Array(length);
  for (let i = 0; i < length; i++) {
    const index = i * 4;
    packedImageData[i] =
      (imageData[index + 2] << 16) | (imageData[index + 1] << 8) | imageData[index];
  }

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

      // Prefix pruning
      if (!(color in node.children)) {
        break;
      }

      node = node.children[color];
      sequenceLength++;

      // Sequence length pruning
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

            const existingSequence = foundSequences[name].find((seq) => {
              if (direction === 'horizontal') {
                return seq.x === foundX && seq.y === foundY;
              } else {
                return seq.x === foundX && seq.y === foundY;
              }
            });

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
      }

      x = (x + 1) % width;
      y = x === 0 ? y + 1 : y;
    }
  }

  if (occurrence === 'first') {
    Object.keys(foundSequences).forEach((name) => {
      foundSequences[name] = foundSequences[name].length > 0 ? foundSequences[name][0] : {};
    });
  }
  // console.log(foundSequences);
  return foundSequences;
}

class TrieNode {
  constructor() {
    this.children = {};
    this.sequences = [];
    this.sequenceLength = 0;
  }
}

function buildTrie(targetSequences) {
  const root = new TrieNode();

  Object.entries(targetSequences).forEach(([name, sequenceObj]) => {
    let node = root;
    const { sequence, direction, offset = { x: 0, y: 0 } } = sequenceObj;
    const packedSequence = sequence.map(([r, g, b]) => (r << 16) | (g << 8) | b);
    const sequenceLength = packedSequence.length;

    for (let i = 0; i < sequenceLength; i++) {
      const color = packedSequence[i];
      if (!(color in node.children)) {
        node.children[color] = new TrieNode();
      }
      node = node.children[color];
      node.sequenceLength = sequenceLength;
      if (i === sequenceLength - 1) {
        node.sequences.push({ name, direction, offset });
      }
    }
  });

  return root;
}

export default findSequences;
