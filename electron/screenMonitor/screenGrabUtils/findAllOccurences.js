import { findSequences } from './findSequences.js';

function findAllOccurrences(imageData, targetSequence) {
  try {
    // Extract dimensions from the buffer
    const bufferWidth = imageData.readUInt32LE(0);
    const bufferHeight = imageData.readUInt32LE(4);

    // Use findSequences to find all occurrences of the target sequence
    const occurrences = findSequences(imageData, { target: targetSequence }, null, 'all');

    // Map the results to the expected format
    const result = occurrences.target.map(({ x, y }) => ({
      x,
      y,
      width: 1, // Assuming the sequence is vertical and has a fixed height
      height: targetSequence.sequence.length, // Height is the length of the sequence
    }));

    return result;
  } catch (error) {
    console.error('Error in findAllOccurrences:', error);
    return [];
  }
}

export default findAllOccurrences;
