class TrieNode {
  constructor() {
    this.children = {};
    this.sequence = null; // This will hold the found sequence coordinates
  }
}

function buildTrie(packedTargetSequence, direction, offset) {
  const root = new TrieNode();
  for (let i = 0; i < packedTargetSequence.length; i++) {
    let node = root;
    const color = packedTargetSequence[i];
    if (!(color in node.children)) {
      node.children[color] = new TrieNode();
    }
    node = node.children[color];
    if (i === packedTargetSequence.length - 1) {
      // Store the found sequence coordinates in the last node
      node.sequence = { foundX: offset.x, foundY: offset.y };
    }
  }
  return root;
}

function findSequence(imageData, targetSequence, width, searchArea = null, occurrence = 0) {
  return new Promise((resolve) => {
    const length = imageData.length / 4;
    let packedImageData = imageData;
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
            // Clear packedImageData
            packedImageData = null;

            clearTrie(trie);
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

    // Clear packedImageData
    packedImageData = null;

    clearTrie(trie);
    resolve({ x: 0, y: 0 });
  });
}

// Assuming buildTrie, clearTrie, and other necessary functions are defined here

export default findSequence;
