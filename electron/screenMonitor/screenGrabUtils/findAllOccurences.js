// screenMonitor/screenGrabUtils/findAllOccurences.js
// REMOVE: All 'require', path calculation, and native module loading at the top.

/**
 * Finds all occurrences of a single target sequence using the passed native function.
 * @param {function} findSequencesNativeFunc - The loaded native findSequences function.
 * @param {Buffer} imageData - Image data buffer including 8-byte header.
 * @param {object} targetSequenceConfig - Sequence config object (e.g., { name: 'mySeq', sequence: [...] }).
 *                                       MUST contain the properties expected by the native parse function.
 * @param {object|null} searchArea - Optional area to search within { x, y, width, height }.
 * @returns {Array<object>} Array of found coordinates { x, y }. Returns [] on error or if none found.
 */
function findAllOccurrences(findSequencesNativeFunc, imageData, targetSequenceConfig, searchArea = null) {
  // --- Input Validation ---
  if (typeof findSequencesNativeFunc !== 'function') {
    console.error('findAllOccurrences: findSequencesNativeFunc (first argument) must be a function.');
    return [];
  }
  if (!imageData || !Buffer.isBuffer(imageData) || imageData.length < 8) {
    console.error('findAllOccurrences: Invalid imageData buffer');
    return [];
  }
  if (!targetSequenceConfig || typeof targetSequenceConfig !== 'object' || !targetSequenceConfig.sequence) {
      console.error('findAllOccurrences: Invalid targetSequenceConfig object passed.', targetSequenceConfig);
      return [];
  }
  // Validate searchArea if provided
  if (searchArea && (typeof searchArea !== 'object' || searchArea.width <= 0 || searchArea.height <= 0)) {
       console.error('findAllOccurrences: Invalid searchArea object provided.', searchArea);
       return [];
  }

  // Determine the key/name to use. Prefer config.name, otherwise use a default.
  const sequenceKey = targetSequenceConfig.name || 'singleTarget';
  if (!targetSequenceConfig.name) {
      // console.warn("findAllOccurrences: targetSequenceConfig missing 'name' property. Using default key 'singleTarget'.");
  }

  // Create the input object for the native function with the determined key.
  const sequencesToFind = { [sequenceKey]: targetSequenceConfig };

  try {
    // Call the PASSED native function with "all" mode
    const results = findSequencesNativeFunc(
        imageData,
        sequencesToFind, // Pass map { 'sequenceName': config }
        searchArea,
        "all"            // Specify "all" mode
    );

    // *** REMOVE DEBUG LOGS ***
    // REMOVE: console.log(`findAllOccurrences DEBUG: Raw result from native call (key='${sequenceKey}'):`, results);
    // REMOVE: try { ... console.log(...) } catch { ... } block for JSON logging
    // *** END REMOVED DEBUG LOGS ***

    // --- Result Handling ---
    // Expect native function to return: { 'sequenceName': [ {x,y}, ... ] } or {} or null/undefined
    if (results && typeof results === 'object' && results[sequenceKey]) {
        const foundData = results[sequenceKey];
        // Check if the result for our key is actually an array
        if (Array.isArray(foundData)) {
            // Optional: Log success
            // console.log(`findAllOccurrences: Found ${foundData.length} occurrences for key '${sequenceKey}'.`);
            return foundData; // Return the array of coordinates
        } else {
            // Log the specific type mismatch error
            console.warn(`findAllOccurrences: Native function returned unexpected data type for key '${sequenceKey}'. Expected array, got: ${typeof foundData}`, foundData);
            return []; // Return empty array if the type is wrong
        }
    } else {
        // Log if nothing was found, especially if a search area was used
        // We check typeof results !== 'undefined' && results !== null to avoid logging "{}" as an error when it's valid (no matches)
        if (typeof results !== 'undefined' && results !== null && Object.keys(results).length > 0 && !results[sequenceKey]) {
             console.warn(`findAllOccurrences: Native result object exists but key '${sequenceKey}' is missing. Results:`, results);
        } else if (searchArea) {
             // console.log(`findAllOccurrences: No occurrences found or key '${sequenceKey}' missing/invalid in results for area:`, searchArea, "Results:", results);
        } else {
             // console.log(`findAllOccurrences: No occurrences found or key '${sequenceKey}' missing/invalid in results for full image. Results:", results);
        }
        return []; // Return empty array if key not found or results are invalid/null/undefined
    }

  } catch (error) {
    // Catch errors during the native call or processing
    console.error(`Error during findAllOccurrences (key: ${sequenceKey}) -> findSequencesNativeFunc call:`, error);
    return []; // Return empty array on any exception
  }
}

export default findAllOccurrences;