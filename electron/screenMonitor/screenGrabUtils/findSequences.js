export const findSequences = (
    imageData,
    targetSequences,
    searchArea = null,
    occurrence = 'first', // "first" (a single match) or "all" (multiple matches)
    ignoreHeaderWarnings = false,
  ) => {
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
  
    // ==========================================================================
    // STEP 1: Flatten each target into variants.
    // Each target becomes one primary variant and, if defined, one backup variant.
    // The original target name remains the same.
    // ==========================================================================
    const sequenceVariants = [];
    for (const [name, config] of Object.entries(targetSequences)) {
      const { sequence: primary, backupSequence, direction, offset = { x: 0, y: 0 } } = config;
  
      // Add the primary variant.
      sequenceVariants.push({
        name,
        sequence: primary,
        direction,
        offset,
        variant: 'primary',
      });
  
      // Add backup variant if it exists.
      if (backupSequence) {
        sequenceVariants.push({
          name,
          sequence: backupSequence,
          direction,
          offset,
          variant: 'backup',
        });
      }
    }
  
    // ==========================================================================
    // STEP 2: Build a lookup keyed by the first color of each variant.
    // Also convert each variant’s sequence into a Uint32Array for fast matching.
    // ==========================================================================
    const firstColorLookup = new Map();
  
    // Convert each variant and add to the lookup.
    const variants = sequenceVariants.map((variant) => {
      const { sequence, direction, name, offset, variant: variantType } = variant;
      const sequenceHashes = new Uint32Array(sequence.length);
      for (let i = 0; i < sequence.length; i++) {
        if (sequence[i] === 'any') {
          sequenceHashes[i] = 0xffffffff; // Special value for "any"
        } else {
          const [r, g, b] = sequence[i];
          sequenceHashes[i] = (r << 16) | (g << 8) | b;
        }
      }
      // Only add to the lookup if the first element isn’t "any"
      if (sequence[0] !== 'any') {
        const [r, g, b] = sequence[0];
        const firstColor = (r << 16) | (g << 8) | b;
        if (!firstColorLookup.has(firstColor)) {
          firstColorLookup.set(firstColor, []);
        }
        firstColorLookup.get(firstColor).push({
          name,
          sequence: sequenceHashes,
          direction,
          offset,
          variant: variantType,
        });
      }
      return {
        name,
        sequence: sequenceHashes,
        direction,
        offset,
        variant: variantType,
      };
    });
  
    // ==========================================================================
    // STEP 3: Prepare candidate storage for each target.
    // For "first", we record the earliest candidate (with pixel index) separately
    // for primary and backup. For "all", we collect arrays (ensuring no duplicates).
    // ==========================================================================
    const candidates = {};
    for (const name of Object.keys(targetSequences)) {
      if (occurrence === 'first') {
        candidates[name] = { primary: null, backup: null };
      } else {
        candidates[name] = { primary: [], backup: [] };
      }
    }
  
    const startIdx = searchArea ? searchArea.startIndex * 3 : 0;
    const endIdx = searchArea ? searchArea.endIndex * 3 : length;
  
    // Precompute values for stepping through pixels.
    const bufferWidth3 = bufferWidth * 3;
    const maxHorizontalIndex = bufferWidth - 1;
    const maxVerticalIndex = bufferHeight - 1;
  
    // Temporary coordinates object to reduce allocations.
    const tempCoords = { x: 0, y: 0 };
  
    // ==========================================================================
    // STEP 4: Scan through each pixel in the image.
    // ==========================================================================
    for (let i = startIdx; i < endIdx; i += 3) {
      // Compute the color hash for the current pixel.
      const color = (rgbData[i] << 16) | (rgbData[i + 1] << 8) | rgbData[i + 2];
      const matchingVariants = firstColorLookup.get(color);
      if (!matchingVariants) continue;
  
      const pixelIndex = i / 3;
      const startX = pixelIndex % bufferWidth;
      const startY = Math.floor(pixelIndex / bufferWidth);
  
      // Check each variant that might begin at this pixel.
      for (const variant of matchingVariants) {
        const { name, sequence, direction, offset, variant: variantType } = variant;
  
        // Quick bounds check:
        if (direction === 'horizontal' && startX + sequence.length - 1 > maxHorizontalIndex) continue;
        if (direction === 'vertical' && startY + sequence.length - 1 > maxVerticalIndex) continue;
  
        let match = true;
        // Compare subsequent pixels against the sequence.
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
          if (expectedColor === 0xffffffff) continue; // "any": skip check
  
          const actualColor = (rgbData[nextIdx] << 16) | (rgbData[nextIdx + 1] << 8) | rgbData[nextIdx + 2];
          if (actualColor !== expectedColor) {
            match = false;
            break;
          }
        }
  
        if (match) {
          // Calculate the coordinates for the FIRST pixel of the sequence (plus offset).
          const firstPixelIndex = i / 3;
          const firstX = firstPixelIndex % bufferWidth;
          const firstY = Math.floor(firstPixelIndex / bufferWidth);
          tempCoords.x = firstX + offset.x;
          tempCoords.y = firstY + offset.y;
  
          if (occurrence === 'first') {
            // For "first", record the candidate along with its pixel index.
            if (variantType === 'primary') {
              // Always prefer primary: update if no candidate exists or if this one is earlier.
              if (!candidates[name].primary || firstPixelIndex < candidates[name].primary.index) {
                candidates[name].primary = { index: firstPixelIndex, coords: { x: tempCoords.x, y: tempCoords.y } };
              }
            } else {
              // For backup, only record if no primary candidate has been recorded.
              if (!candidates[name].primary) {
                if (!candidates[name].backup || firstPixelIndex < candidates[name].backup.index) {
                  candidates[name].backup = { index: firstPixelIndex, coords: { x: tempCoords.x, y: tempCoords.y } };
                }
              }
            }
          } else {
            // For "all" occurrences, add the candidate if it isn’t a duplicate.
            const addCandidate = (list) => {
              if (!list.some((pt) => pt.x === tempCoords.x && pt.y === tempCoords.y)) {
                list.push({ x: tempCoords.x, y: tempCoords.y });
              }
            };
            if (variantType === 'primary') {
              addCandidate(candidates[name].primary);
            } else {
              // Only add backup candidate if no primary candidate exists.
              addCandidate(candidates[name].backup);
            }
          }
        }
      }
    }
  
    // ==========================================================================
    // STEP 5: Build the final result based on candidate preferences.
    // For each target, if a primary candidate exists, use it; otherwise, use backup.
    // ==========================================================================
    const foundSequences = {};
    for (const name of Object.keys(targetSequences)) {
      if (occurrence === 'first') {
        if (candidates[name].primary) {
          foundSequences[name] = candidates[name].primary.coords;
        } else if (candidates[name].backup) {
          foundSequences[name] = candidates[name].backup.coords;
        } else {
          foundSequences[name] = null;
        }
      } else {
        // For "all", return primary candidates if any; otherwise, the backup candidates.
        foundSequences[name] = candidates[name].primary.length > 0 ? candidates[name].primary : candidates[name].backup;
      }
    }
  
    return foundSequences;
  };
  