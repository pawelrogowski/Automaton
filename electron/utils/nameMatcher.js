// utils/nameMatcher.js

/**
 * Utilities for matching OCR'd creature names to canonical names.
 *
 * Key points:
 * - Default matching threshold lowered to 0.3 for OCR tolerance.
 * - getSimilarityScore parameter order is (ocrName, canonicalName).
 * - Fixed bug: no reassignment of consts in levenshteinDistance.
 */

/**
 * Cleans a name for comparison:
 * - lowercases
 * - removes separators and common OCR garbage
 * - strips digits (often misread)
 * - collapses multiple spaces
 */
export function cleanName(name) {
  if (!name) return '';
  return (
    String(name)
      .toLowerCase()
      // Remove punctuation and likely OCR artifacts
      .replace(/['"`’”“.,:;_+\-()\[\]{}\/\\|]/g, '')
      // Keep only letters and spaces
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Levenshtein distance (iterative, memory-efficient).
 * Returns number of edits between a and b.
 */
export function levenshteinDistance(a, b) {
  a = a || '';
  b = b || '';
  if (a === b) return 0;

  let al = a.length;
  let bl = b.length;

  if (al === 0) return bl;
  if (bl === 0) return al;

  // Ensure the shorter string is `a` to save memory
  if (al > bl) {
    // swap values (a <-> b) and lengths
    const tmpStr = a;
    a = b;
    b = tmpStr;
    const tmpLen = al;
    al = bl;
    bl = tmpLen;
  }

  let prev = new Array(al + 1);
  let curr = new Array(al + 1);

  for (let i = 0; i <= al; i++) prev[i] = i;

  for (let j = 1; j <= bl; j++) {
    curr[0] = j;
    const bj = b.charAt(j - 1);
    for (let i = 1; i <= al; i++) {
      const cost = a.charAt(i - 1) === bj ? 0 : 1;
      // deletion: prev[i] + 1
      // insertion: curr[i-1] + 1
      // substitution: prev[i-1] + cost
      let v = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      if (ins < v) v = ins;
      const sub = prev[i - 1] + cost;
      if (sub < v) v = sub;
      curr[i] = v;
    }
    // swap rows
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[al];
}

/**
 * Longest common substring length between two cleaned strings.
 */
export function longestCommonSubstring(s1, s2) {
  s1 = cleanName(s1);
  s2 = cleanName(s2);
  if (!s1 || !s2) return 0;

  const n = s1.length;
  const m = s2.length;
  let prev = new Array(m + 1).fill(0);
  let maxLen = 0;

  for (let i = 1; i <= n; i++) {
    const curr = new Array(m + 1).fill(0);
    const si = s1[i - 1];
    for (let j = 1; j <= m; j++) {
      if (si === s2[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) maxLen = curr[j];
      }
    }
    prev = curr;
  }
  return maxLen;
}

/**
 * Returns a similarity score between 0 and 1.
 * - Parameter order: (ocrName, canonicalName)
 * - Fast exits for exact matches, then combined Lev/LCS fallback.
 */
export function getSimilarityScore(ocrName, canonicalName) {
  if (!ocrName || !canonicalName) return 0;

  // Fast exact (case-insensitive)
  if (ocrName.toLowerCase() === canonicalName.toLowerCase()) return 1.0;

  const cleanOcr = cleanName(ocrName);
  const cleanCanon = cleanName(canonicalName);

  if (cleanOcr.length === 0 || cleanCanon.length === 0) return 0;

  // Cleaned exact
  if (cleanOcr === cleanCanon) return 0.99;

  // Prefix checks (battlelist truncation like "Dragon Lo...")
  if (cleanCanon.startsWith(cleanOcr) || cleanOcr.startsWith(cleanCanon)) {
    return 0.95;
  }

  // Longest Common Substring ratio
  const lcsLen = longestCommonSubstring(cleanOcr, cleanCanon);
  const minLen = Math.min(cleanOcr.length, cleanCanon.length);
  const lcsRatio = minLen > 0 ? lcsLen / minLen : 0;

  // Levenshtein-based ratio
  const dist = levenshteinDistance(cleanOcr, cleanCanon);
  const maxLen = Math.max(cleanOcr.length, cleanCanon.length);
  const levRatio = maxLen > 0 ? 1 - dist / maxLen : 0;

  // Weighted combination: favor Levenshtein for scattered errors, LCS helps with partial overlap
  const score = levRatio * 0.7 + lcsRatio * 0.3;

  return Math.max(0, Math.min(1, score));
}

/**
 * Finds the best match for an OCR name from canonicalNames.
 * Returns the canonical name if the highest score is >= threshold.
 * Default threshold: 0.3 (per user request).
 */
export function findBestNameMatch(
  ocrName,
  canonicalNames = [],
  threshold = 0.3,
) {
  if (!ocrName || typeof ocrName !== 'string') return null;
  if (!Array.isArray(canonicalNames) || canonicalNames.length === 0)
    return null;

  let best = null;
  let bestScore = -1;

  for (const name of canonicalNames) {
    if (!name) continue;
    const score = getSimilarityScore(ocrName, name);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (bestScore >= threshold) return best;
  return null;
}

/**
 * Checks whether a battle list entry (which can be truncated or noisy) matches a full canonical name.
 * Signature: isBattleListMatch(fullName, battleListEntryName)
 */
export function isBattleListMatch(fullName, battleListEntryName) {
  if (!fullName || !battleListEntryName) return false;

  // Direct equality
  if (fullName === battleListEntryName) return true;

  // Truncated battlelist entries ending with "..."
  if (battleListEntryName.endsWith('...')) {
    const truncated = battleListEntryName.slice(0, -3).trim();
    if (truncated.length === 0) return false;
    return cleanName(fullName).startsWith(cleanName(truncated));
  }

  // Fallback to fuzzy matching (battleListEntryName considered OCR-like)
  return getSimilarityScore(battleListEntryName, fullName) > 0.8;
}
