export const findSequences = (imageData, targetSequences, searchArea = null, occurrence = 'first', ignoreHeaderWarnings = false) => {
  if (imageData.length < 8) throw new Error(`Buffer too short to contain dimensions. Length: ${imageData.length}`);

  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);

  if (!ignoreHeaderWarnings) {
    const expectedLength = bufferWidth * bufferHeight * 3;
    if (imageData.length < expectedLength) {
      throw new Error(
        `Buffer too short for declared dimensions: ${bufferWidth}x${bufferHeight}. Expected: ${expectedLength}, Received: ${imageData.length}`,
      );
    }
  }

  const rgbData = new Uint8Array(imageData.buffer, imageData.byteOffset + 8);
  const length = rgbData.length;

  // Precompute color hashes for target sequences
  const firstColorLookup = new Map();
  const sequences = new Map();

  // Use Uint32Array for sequence color hashes
  for (const [name, { sequence, direction, offset = { x: 0, y: 0 } }] of Object.entries(targetSequences)) {
    if (sequence[0] !== 'any') {
      const [r, g, b] = sequence[0];
      const firstColor = (r << 16) | (g << 8) | b;
      if (!firstColorLookup.has(firstColor)) {
        firstColorLookup.set(firstColor, []);
      }
      firstColorLookup.get(firstColor).push(name);
    }

    // Convert sequence to Uint32Array for faster access
    const sequenceHashes = new Uint32Array(sequence.length);
    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] === 'any') {
        sequenceHashes[i] = 0xffffffff; // Use a special value for 'any'
      } else {
        const [r, g, b] = sequence[i];
        sequenceHashes[i] = (r << 16) | (g << 8) | b;
      }
    }

    sequences.set(name, {
      sequence: sequenceHashes,
      direction,
      offset,
    });
  }

  // Preallocate foundSequences based on occurrence
  const foundSequences = Object.fromEntries(
    Object.keys(targetSequences).map((name) => [
      name,
      occurrence === 'first' ? null : [], // Preallocate null for 'first', empty array for others
    ]),
  );

  const startIdx = searchArea ? searchArea.startIndex * 3 : 0;
  const endIdx = searchArea ? searchArea.endIndex * 3 : length;

  // Precompute bufferWidth * 3 for horizontal direction
  const bufferWidth3 = bufferWidth * 3;

  // Precompute maximum allowed indices for bounds checking
  const maxHorizontalIndex = bufferWidth - 1;
  const maxVerticalIndex = bufferHeight - 1;

  // Reuse a single object for coordinates to reduce allocations
  const tempCoords = { x: 0, y: 0 };

  for (let i = startIdx; i < endIdx; i += 3) {
    const color = (rgbData[i] << 16) | (rgbData[i + 1] << 8) | rgbData[i + 2];

    const matchingSequences = firstColorLookup.get(color);
    if (!matchingSequences) continue;

    const pixelIndex = i / 3;
    const startX = pixelIndex % bufferWidth;
    const startY = Math.floor(pixelIndex / bufferWidth);

    for (const seqName of matchingSequences) {
      const { sequence, direction, offset } = sequences.get(seqName);

      // Quick bounds check using precomputed values
      if (direction === 'horizontal' && startX + sequence.length - 1 > maxHorizontalIndex) continue;
      if (direction === 'vertical' && startY + sequence.length - 1 > maxVerticalIndex) continue;

      let match = true;
      for (let j = 1; j < sequence.length; j++) {
        let nextIdx;
        if (direction === 'horizontal') {
          nextIdx = i + j * 3;
        } else {
          nextIdx = i + j * bufferWidth3;
        }

        if (nextIdx >= length) {
          match = false;
          break;
        }

        const expectedColor = sequence[j];
        if (expectedColor === 0xffffffff) continue; // Skip 'any' checks

        const actualColor = (rgbData[nextIdx] << 16) | (rgbData[nextIdx + 1] << 8) | rgbData[nextIdx + 2];
        if (actualColor !== expectedColor) {
          match = false;
          break;
        }
      }

      if (match) {
        // Calculate coordinates for the FIRST pixel in the sequence
        const firstPixelIndex = i / 3;
        const firstX = firstPixelIndex % bufferWidth;
        const firstY = Math.floor(firstPixelIndex / bufferWidth);

        // Apply the offset to the FIRST pixel
        tempCoords.x = firstX + offset.x;
        tempCoords.y = firstY + offset.y;

        if (occurrence === 'first') {
          if (foundSequences[seqName] === null) {
            foundSequences[seqName] = { x: tempCoords.x, y: tempCoords.y };
            // Early exit if we found all sequences
            if (Object.values(foundSequences).every((seq) => seq !== null)) {
              return foundSequences;
            }
          }
        } else {
          // Check for duplicates without allocating new objects
          const exists = foundSequences[seqName].some((seq) => seq.x === tempCoords.x && seq.y === tempCoords.y);
          if (!exists) {
            foundSequences[seqName].push({ x: tempCoords.x, y: tempCoords.y });
          }
        }
      }
    }
  }

  return foundSequences;
};
