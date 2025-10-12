// electron/utils/nameMatcher.js

/**
 * Cleans a name for comparison: lowercase, removes spaces and common OCR garbage.
 */
export function cleanName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/['"._-\s]/g, '') // Remove separator chars
    .replace(/[0-9]/g, ''); // Remove numbers often mistaken for letters
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          ),
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculates length of longest common substring.
 */
export function longestCommonSubstring(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = cleanName(str1);
  const s2 = cleanName(str2);
  
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix = Array(s1.length + 1)
    .fill(0)
    .map(() => Array(s2.length + 1).fill(0));

  let maxLength = 0;

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
        if (matrix[i][j] > maxLength) {
          maxLength = matrix[i][j];
        }
      }
    }
  }
  return maxLength;
}

/**
 * Calculates a similarity score between 0 and 1 using cascading checks.
 * Handles OCR errors, truncation, and garbage characters.
 */
export function getSimilarityScore(ocrName, canonicalName) {
  if (!ocrName || !canonicalName) return 0;

  // 1. Exact match (case insensitive)
  if (ocrName.toLowerCase() === canonicalName.toLowerCase()) return 1.0;

  const cleanOcr = cleanName(ocrName);
  const cleanCanonical = cleanName(canonicalName);

  if (cleanOcr.length < 3 || cleanCanonical.length < 3) return 0;

  // 2. Cleaned exact match
  if (cleanOcr === cleanCanonical) return 0.99;

  // 3. Prefix match (handling battle list truncation like "Dragon Lo...")
  if (cleanCanonical.startsWith(cleanOcr) || cleanOcr.startsWith(cleanCanonical)) {
    return 0.95;
  }

  // 4. Longest Common Substring (handles partial occlusion)
  const lcsLength = longestCommonSubstring(ocrName, canonicalName);
  const minLen = Math.min(cleanOcr.length, cleanCanonical.length);
  const lcsRatio = lcsLength / minLen;

  // 5. Levenshtein Distance (handles scattered OCR typos like "lfl h" -> "marsh")
  const dist = levenshteinDistance(cleanOcr, cleanCanonical);
  const maxLen = Math.max(cleanOcr.length, cleanCanonical.length);
  const levRatio = 1 - (dist / maxLen);

  // Combine scores, favoring Levenshtein for scattered errors
  // Example: "lflhstalke" vs "marshstalker"
  // LCS captures "stalk", Lev captures overall structure.
  
  // Weighted score favoring Levenshtein
  return (levRatio * 0.7) + (lcsRatio * 0.3);
}

/**
 * Finds the best match for an OCR name from a list of canonical names.
 * Uses a cascading strategy with a confidence threshold.
 */
export function findBestNameMatch(ocrName, canonicalNames, threshold = 0.55) {
  if (!ocrName || ocrName.length < 3 || !canonicalNames || canonicalNames.length === 0) {
    return null;
  }

  let bestMatch = null;
  let highestScore = -1;

  for (const name of canonicalNames) {
    const score = getSimilarityScore(ocrName, name);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = name;
    }
  }

  if (highestScore >= threshold) {
    return bestMatch;
  }

  return null; // No match found above threshold
}

/**
 * Checks if a battle list entry (potentially truncated) matches a full name.
 */
export function isBattleListMatch(fullName, battleListEntryName) {
  if (!fullName || !battleListEntryName) return false;
  if (fullName === battleListEntryName) return true;
  
  if (battleListEntryName.endsWith('...')) {
    const truncated = battleListEntryName.slice(0, -3);
    return fullName.startsWith(truncated);
  }
  
  // Fallback to fuzzy match for battle list OCR errors
  return getSimilarityScore(battleListEntryName, fullName) > 0.8;
}