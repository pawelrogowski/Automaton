// trieUtils.js

// TrieNode class definition.
class TrieNode {
  constructor() {
    // Initialize the node's properties.
    this.children = {};
    this.sequences = [];
    this.sequenceLength = 0;
  }
}

// Function to build a trie from the target sequences.
function buildTrie(targetSequences) {
  const root = new TrieNode();
  // Iterate over each target sequence.
  Object.entries(targetSequences).forEach(([name, sequenceObj]) => {
    let node = root;
    // Extract sequence details.
    const { sequence, direction, offset = { x: 0, y: 0 } } = sequenceObj;
    // Pack the sequence's colors into a single integer.
    const packedSequence = sequence.map(([r, g, b]) => (r << 16) | (g << 8) | b);
    const sequenceLength = packedSequence.length;
    // Build the trie by adding each color in the sequence to the trie.
    for (let i = 0; i < sequenceLength; i++) {
      const color = packedSequence[i];
      if (!(color in node.children)) {
        node.children[color] = new TrieNode();
      }
      node = node.children[color];
      node.sequenceLength = sequenceLength;
      // If this is the last color in the sequence, add the sequence details to the node.
      if (i === sequenceLength - 1) {
        node.sequences.push({ name, direction, offset });
      }
    }
  });
  return root;
}

// Function to clear trie nodes.
function clearTrieNodes(node) {
  if (!node) {
    return;
  }
  // Recursively clear child nodes.
  for (const childNode of Object.values(node.children)) {
    clearTrieNodes(childNode);
  }
  // Clear the current node's properties.
  node.children = null;
  node.sequences = null;
  node.sequenceLength = 0;
}

// Export the TrieNode class, buildTrie function, and clearTrieNodes function.
export { TrieNode, buildTrie, clearTrieNodes };
