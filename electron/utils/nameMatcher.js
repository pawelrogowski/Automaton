function longestCommonSubstring(str1, str2) {
  const s1 = str1.toLowerCase().replace(/\s/g, '');
  const s2 = str2.toLowerCase().replace(/\s/g, '');
  let maxLength = 0;
  let endIndex = 0;

  const matrix = Array(s1.length + 1)
    .fill(0)
    .map(() => Array(s2.length + 1).fill(0));

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
        if (matrix[i][j] > maxLength) {
          maxLength = matrix[i][j];
          endIndex = i;
        }
      }
    }
  }
  return s1.substring(endIndex - maxLength, endIndex);
}

export function findBestNameMatch(ocrName, canonicalNames, logger) {
  if (!ocrName) {
    return null;
  }

  // First, check for a perfect, case-insensitive match. This is the highest confidence scenario.
  const perfectMatch = canonicalNames.find(
    (name) => name.toLowerCase() === ocrName.toLowerCase(),
  );
  if (perfectMatch) {
    return perfectMatch;
  }

  // If no perfect match, proceed with fuzzy matching for partial names.
  if (ocrName.length < 4) {
    return ocrName; // Not enough info for a confident fuzzy match, return raw.
  }

  let bestMatch = null;
  let highestScore = 0;

  for (const canonicalName of canonicalNames) {
    const commonSubstring = longestCommonSubstring(ocrName, canonicalName);
    const score = commonSubstring.length;

    if (score > highestScore) {
      highestScore = score;
      bestMatch = canonicalName;
    }
  }

  // Confidence check: The match must be at least 4 characters long
  // and represent a significant portion of the OCR'd name.
  if (highestScore >= 4 && highestScore > ocrName.length * 0.6) {
    if (ocrName !== bestMatch) {
      logger(
        'debug',
        `[NameMatcher] Matched OCR name "${ocrName}" to canonical name "${bestMatch}" (Score: ${highestScore})`,
      );
    }
    return bestMatch;
  }

  // If no high-confidence match is found, return the original OCR name for debugging.
  return ocrName;
}
