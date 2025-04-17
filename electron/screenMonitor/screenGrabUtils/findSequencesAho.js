// electron/screenMonitor/screenGrabUtils/findSequencesAho.js
import AC from 'ahocorasick';

// Helper to compare two arrays for equality
const arraysAreEqual = (arr1, arr2) => {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) return false;
    }
    return true;
};

// Helper to convert [r, g, b] to a single integer hash
const colorToHash = (r, g, b) => (r << 16) | (g << 8) | b;

export const findSequencesAho = (
  imageData,
  targetSequences,
  searchArea = null,
  occurrence = 'first', // "first" or "all"
  // Note: ignoreHeaderWarnings and "any" color are not supported in this version
) => {
  if (imageData.length < 8) throw new Error(`Buffer too short...`); // Basic validation

  const bufferWidth = imageData.readUInt32LE(0);
  const bufferHeight = imageData.readUInt32LE(4);
  const rgbData = new Uint8Array(imageData.buffer, imageData.byteOffset + 8);

  // ==========================================================================
  // STEP 1: Prepare sequences and map colors to unique integers
  // ==========================================================================
  const colorMap = new Map();
  let nextColorId = 0;
  const mappedSequences = []; // Will store { name, sequence: [int], direction, offset, variant }
  const keywords = []; // For Ahocorasick library: arrays of integers

  for (const [name, config] of Object.entries(targetSequences)) {
    const { sequence: primary, backupSequence, direction, offset = { x: 0, y: 0 } } = config;

    const processSequence = (seq, variantType) => {
      if (!seq || direction !== 'horizontal') return; // Start with horizontal only

      const mappedSeq = [];
      let possible = true;
      for (const color of seq) {
        if (color === 'any') {
           // console.warn(`Aho-Corasick implementation doesn't support 'any' yet. Skipping sequence ${name}`);
           possible = false;
           break; // Skip sequences with 'any'
        }
        const [r, g, b] = color;
        const hash = colorToHash(r, g, b);
        if (!colorMap.has(hash)) {
          colorMap.set(hash, nextColorId++);
        }
        mappedSeq.push(colorMap.get(hash));
      }

       if (possible && mappedSeq.length > 0) {
         // Store the original sequence info along with the mapped integer sequence
         mappedSequences.push({
           name,
           originalSequence: seq, // Keep original for length calculation if needed
           mappedSequence: mappedSeq,
           direction,
           offset,
           variant: variantType
          });
         keywords.push(mappedSeq); // Add the integer array to keywords for AC
       }
    };

    processSequence(primary, 'primary');
    if (backupSequence) {
      processSequence(backupSequence, 'backup');
    }
  }

  if (keywords.length === 0) {
    // console.warn("No suitable horizontal sequences found for Aho-Corasick.");
    return {}; // Return empty if no processable sequences
  }

  // ==========================================================================
  // STEP 2: Build the Aho-Corasick Automaton using 'ahocorasick'
  // ==========================================================================
  const ac = new AC(keywords); // Changed constructor usage (might be identical, but using the new import)

  // ==========================================================================
  // STEP 3: Prepare candidate storage
  // ==========================================================================
   const candidates = {}; // Similar structure to original findSequences
   for (const name of Object.keys(targetSequences)) {
     if (occurrence === 'first') {
       candidates[name] = { primary: null, backup: null }; // { index: number, coords: {x, y} }
     } else {
       candidates[name] = { primary: [], backup: [] }; // Array of {x, y}
     }
   }


  // ==========================================================================
  // STEP 4: Scan the image data row by row (within searchArea if specified)
  // ==========================================================================
  const startRow = searchArea ? Math.floor(searchArea.startIndex / bufferWidth) : 0;
  const endRow = searchArea ? Math.ceil(searchArea.endIndex / bufferWidth) : bufferHeight;
  const startCol = searchArea ? searchArea.startIndex % bufferWidth : 0;
  // Adjust endCol logic for searchArea if needed (ensure it's exclusive or inclusive as required)
  const endCol = searchArea ? (searchArea.endIndex % bufferWidth) + 1 : bufferWidth;


  for (let y = startRow; y < endRow; y++) {
    const rowStartOffset = y * bufferWidth * 3;
    const mappedRow = [];
    const pixelIndicesInRow = []; // Store original pixel index for coordinate mapping

    // Define the columns to process in this row based on searchArea
    const effectiveStartCol = (y === startRow && searchArea) ? startCol : 0;
     // Careful with end index calculation depending on searchArea definition (inclusive/exclusive)
    const effectiveEndCol = (y === endRow - 1 && searchArea) ? endCol : bufferWidth;


    for (let x = effectiveStartCol; x < effectiveEndCol; x++) {
       const idx = rowStartOffset + x * 3;
       // Boundary check
       if (idx + 2 >= rgbData.length) {
           console.warn(`Skipping pixel at (${x}, ${y}) - index out of bounds.`);
           continue;
       }
       const hash = colorToHash(rgbData[idx], rgbData[idx + 1], rgbData[idx + 2]);
       if (colorMap.has(hash)) {
           mappedRow.push(colorMap.get(hash));
       } else {
           // Use a value guaranteed not in colorMap's mapped IDs (e.g., -1 if IDs start from 0)
           mappedRow.push(-1);
       }
       pixelIndicesInRow.push(y * bufferWidth + x); // Store original flat index relative to buffer start
    }

    if (mappedRow.length === 0) continue; // Skip if row is empty after filtering


    // Run Aho-Corasick on the mapped row. The 'ahocorasick' package's search
    // typically returns results in a similar format: [endIndex, [keywordIndices]]
    const results = ac.search(mappedRow);

    // Process results
    for (const result of results) {
       // Check if result format is as expected
       if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) {
          console.warn("Unexpected result format from Aho-Corasick search:", result);
          continue;
       }

      const [endIndexInRow, matchedKeywordArrays] = result; // endIndex is the index in mappedRow

      // Add logging for the found indices array
      console.log(`Aho-Corasick Result: endIndex=${endIndexInRow}, foundKeywordIndices=[${matchedKeywordArrays.map(arr => arr.join(',')).join(', ')}] (Type: ${typeof matchedKeywordArrays}, Length: ${matchedKeywordArrays.length})`);

      for (const matchedKeywordArray of matchedKeywordArrays) {
         // **FIX:** Find the corresponding info object in mappedSequences
         // by comparing the matchedKeywordArray with the .mappedSequence property
         const matchedInfo = mappedSequences.find(info =>
             arraysAreEqual(info.mappedSequence, matchedKeywordArray)
         );

         // If we didn't find a match (shouldn't happen if setup is correct)
         if (!matchedInfo) {
             // console.warn("Could not find matching sequence info for keyword:", matchedKeywordArray);
             continue;
         }

        // Now we have the correct info (name, offset, variant, etc.)
        const { name, mappedSequence, offset, variant } = matchedInfo;
        const sequenceLength = mappedSequence.length;

        // Calculate coordinates of the *start* of the sequence in the original buffer
        const startIndexInRow = endIndexInRow - sequenceLength + 1;
        if (startIndexInRow < 0 || startIndexInRow >= pixelIndicesInRow.length) {
           console.warn(`  Calculated invalid startIndexInRow: ${startIndexInRow} for endIndexInRow: ${endIndexInRow}, sequenceLength: ${sequenceLength}`);
           continue;
        }

        const originalPixelIndex = pixelIndicesInRow[startIndexInRow];
        const startX = originalPixelIndex % bufferWidth;
        const startY = Math.floor(originalPixelIndex / bufferWidth);

        if (startX < 0 || startX >= bufferWidth || startY < 0 || startY >= bufferHeight) {
            console.warn(`  Calculated out-of-bounds start coordinates: (${startX}, ${startY})`);
            continue;
        }


        const finalCoords = { x: startX + offset.x, y: startY + offset.y };

        // --- Add to candidates (similar logic as original findSequences) ---
        if (occurrence === 'first') {
             if (variant === 'primary') {
               if (!candidates[name].primary || originalPixelIndex < candidates[name].primary.index) {
                 candidates[name].primary = { index: originalPixelIndex, coords: finalCoords };
               }
             } else { // backup
               if (!candidates[name].primary) { // Only consider backup if no primary found yet
                 if (!candidates[name].backup || originalPixelIndex < candidates[name].backup.index) {
                    candidates[name].backup = { index: originalPixelIndex, coords: finalCoords };
                 }
               }
             }
        } else { // occurrence === 'all'
            const targetListKey = (variant === 'primary' || candidates[name].primary.length > 0) ? 'primary' : 'backup';
            const list = candidates[name][targetListKey];

             // Add only if not already present (check coords)
             if (!list.some(pt => pt.x === finalCoords.x && pt.y === finalCoords.y)) {
                 // If we are adding a primary, clear backups for 'all' mode if needed,
                 // or decide on merging strategy if both primary and backup can co-exist in 'all'
                 if (variant === 'primary' && targetListKey === 'primary' && candidates[name].backup.length > 0 && candidates[name].primary.length === 0) {
                    // If first primary found, maybe clear backups? Depends on desired 'all' logic.
                    // For now, just add to the correct list.
                 }

                 // Only add backup if no primary results exist overall for this name
                 if (variant !== 'primary' && candidates[name].primary.length > 0) {
                     // Don't add backup if primary ones exist
                 } else {
                    list.push(finalCoords);
                 }
             }
        }
        // --------------------------------------------------------------------
      }
    }
  }

  // ==========================================================================
  // STEP 5: Build the final result object (same logic as original findSequences)
  // ==========================================================================
  const foundSequences = {};
   for (const name of Object.keys(targetSequences)) {
     if (!candidates[name]) continue; // Ensure candidate entry exists

     if (occurrence === 'first') {
       if (candidates[name].primary) {
         foundSequences[name] = candidates[name].primary.coords;
       } else if (candidates[name].backup) {
         foundSequences[name] = candidates[name].backup.coords;
       } else {
         foundSequences[name] = null;
       }
     } else { // 'all'
       // Prefer primary results if they exist, otherwise use backup
       // Ensure lists exist before checking length
       const primaryExists = candidates[name].primary && candidates[name].primary.length > 0;
       const backupExists = candidates[name].backup && candidates[name].backup.length > 0;

       if (primaryExists) {
          foundSequences[name] = candidates[name].primary;
       } else if (backupExists) {
          foundSequences[name] = candidates[name].backup;
       } else {
          foundSequences[name] = []; // Return empty array if neither found
       }
     }
   }

  return foundSequences;
};