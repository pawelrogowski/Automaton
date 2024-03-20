function findSequence(imageData, targetSequence, width, searchArea = null, occurrence = 0) {
  return new Promise((resolve) => {
    const length = imageData.length / 4;
    const packedImageData = new Uint32Array(length);
    for (let i = 0; i < length; i++) {
      const index = i * 4;
      packedImageData[i] =
        (imageData[index + 2] << 16) | (imageData[index + 1] << 8) | imageData[index];
    }

    const { sequence, direction, offset = { x: 0, y: 0 } } = targetSequence;
    const packedTargetSequence = sequence.map(([r, g, b]) => (r << 16) | (g << 8) | b);
    const sequenceLength = packedTargetSequence.length;
    const foundSequences = [];

    const trie = buildTrie(packedTargetSequence, direction, offset);

    const startIndex = searchArea ? searchArea.startIndex : 0;
    const endIndex = searchArea ? searchArea.endIndex : length - sequenceLength;

    outer: for (let i = startIndex; i <= endIndex; i++) {
      let x = i % width;
      let y = Math.floor(i / width);
      let node = trie;
      let sequenceIndex = 0;

      for (let j = i; j < length; j++) {
        const color = packedImageData[j];

        if (!(color in node.children)) {
          break;
        }

        node = node.children[color];
        sequenceIndex++;

        if (sequenceIndex === sequenceLength) {
          const { foundX, foundY } = node.sequence;
          foundSequences.push({ x: foundX, y: foundY });

          if (occurrence === 0 || foundSequences.length === occurrence) {
            resolve(foundSequences[occurrence === 0 ? 0 : occurrence - 1] || { x: 0, y: 0 });
            return;
          }

          sequenceIndex = 0;
          node = trie;
          continue outer;
        }

        x = (x + 1) % width;
        y = x === 0 ? y + 1 : y;
      }
    }

    resolve({ x: 0, y: 0 });
  });
}

class TrieNode {
  constructor() {
    this.children = {};
    this.sequence = null;
  }
}

function buildTrie(packedTargetSequence, direction, offset) {
  const root = new TrieNode();
  let node = root;

  for (let i = 0; i < packedTargetSequence.length; i++) {
    const color = packedTargetSequence[i];

    if (!(color in node.children)) {
      node.children[color] = new TrieNode();
    }

    node = node.children[color];

    if (i === packedTargetSequence.length - 1) {
      let foundX, foundY;

      if (direction === 'horizontal') {
        foundX = offset.x + 1 - packedTargetSequence.length;
        foundY = offset.y;
      } else {
        foundX = -offset.x;
        foundY = offset.y + 1 - packedTargetSequence.length;
      }

      node.sequence = { foundX, foundY };
    }
  }

  return root;
}

export default findSequence;
