import { buildTrie, clearTrieNodes } from './trieUtils.js';

export const findSequences = (imageData, targetSequences, searchArea = null, occurrence = 'first', ignoreHeaderWarrnings = false) => {
  if (imageData.length < 8) throw new Error(`Buffer too short to contain dimensions. Length: ${imageData.length}`);

  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);

  if (!ignoreHeaderWarrnings) {
    const expectedLength = bufferWidth * bufferHeight * 3;
    if (imageData.length < expectedLength) {
      throw new Error(
        `Buffer too short for declared dimensions: ${bufferWidth}x${bufferHeight}. Expected: ${expectedLength}, Received: ${imageData.length}`,
      );
    }
  }

  const rgbData = imageData.subarray(8);
  const length = rgbData.length;

  // Create fast lookup for first colors of each sequence
  const firstColorLookup = new Map();
  const sequences = new Map();

  for (const [name, { sequence, direction, offset = { x: 0, y: 0 } }] of Object.entries(targetSequences)) {
    // Only process first color if it's not 'any'
    if (sequence[0] !== 'any') {
      const [r, g, b] = sequence[0];
      const firstColor = (r << 16) | (g << 8) | b;
      if (!firstColorLookup.has(firstColor)) {
        firstColorLookup.set(firstColor, []);
      }
      firstColorLookup.get(firstColor).push(name);
    }
    sequences.set(name, {
      sequence: sequence.map((color) => {
        if (color === 'any') return 'any';
        const [r, g, b] = color;
        return (r << 16) | (g << 8) | b;
      }),
      direction,
      offset,
    });
  }

  const foundSequences = Object.fromEntries(Object.keys(targetSequences).map((name) => [name, occurrence === 'first' ? {} : []]));

  const startIdx = searchArea ? searchArea.startIndex * 3 : 0;
  const endIdx = searchArea ? searchArea.endIndex * 3 : length;

  // Fast scan using packed ints
  for (let i = startIdx; i < endIdx; i += 3) {
    const color = (rgbData[i] << 16) | (rgbData[i + 1] << 8) | rgbData[i + 2];

    // Skip if this color isn't the start of any sequence
    const matchingSequences = firstColorLookup.get(color);
    if (!matchingSequences) continue;

    const pixelIndex = i / 3;
    const startX = pixelIndex % bufferWidth;
    const startY = Math.floor(pixelIndex / bufferWidth);

    // Check each sequence that starts with this color
    for (const seqName of matchingSequences) {
      const { sequence, direction, offset } = sequences.get(seqName);

      // Quick bounds check
      if (direction === 'horizontal' && startX + sequence.length > bufferWidth) continue;
      if (direction === 'vertical' && startY + sequence.length > bufferHeight) continue;

      let match = true;
      // Check remaining colors in sequence
      for (let j = 1; j < sequence.length; j++) {
        let nextIdx;
        if (direction === 'horizontal') {
          nextIdx = i + j * 3;
        } else {
          nextIdx = i + j * bufferWidth * 3;
        }

        if (nextIdx >= length) {
          match = false;
          break;
        }

        const expectedColor = sequence[j];
        if (expectedColor === 'any') continue;

        const actualColor = (rgbData[nextIdx] << 16) | (rgbData[nextIdx + 1] << 8) | rgbData[nextIdx + 2];
        if (actualColor !== expectedColor) {
          match = false;
          break;
        }
      }

      if (match) {
        let foundX, foundY;

        // Calculate position at end of sequence, like the trie version does
        if (direction === 'horizontal') {
          const endPixelIndex = (i + (sequence.length - 1) * 3) / 3;
          const endX = endPixelIndex % bufferWidth;
          const endY = Math.floor(endPixelIndex / bufferWidth);
          foundX = endX + offset.x;
          foundY = endY + offset.y;
        } else {
          const endPixelIndex = (i + (sequence.length - 1) * bufferWidth * 3) / 3;
          const endX = endPixelIndex % bufferWidth;
          const endY = Math.floor(endPixelIndex / bufferWidth);
          foundX = endX - offset.x;
          foundY = endY - offset.y;
        }

        if (occurrence === 'first') {
          if (Object.keys(foundSequences[seqName]).length === 0) {
            foundSequences[seqName] = { x: foundX, y: foundY };
            // Early exit if we found all sequences
            if (Object.values(foundSequences).every((seq) => Object.keys(seq).length > 0)) {
              return foundSequences;
            }
          }
        } else {
          const exists = foundSequences[seqName].some((seq) => seq.x === foundX && seq.y === foundY);
          if (!exists) foundSequences[seqName].push({ x: foundX, y: foundY });
        }
      }
    }
  }

  return foundSequences;
};
