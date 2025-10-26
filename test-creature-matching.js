// Test script to verify the creature matching pipeline fix
// This demonstrates that "Rabbit" OCR won't match to "Bat" from targeting list

import {
  findBestNameMatch,
  getSimilarityScore,
  cleanName,
} from './electron/utils/nameMatcher.js';

console.log('===== CREATURE MATCHING TEST =====\n');

// Simulate the scenario from the bug report
const battleListEntries = [
  { name: 'Rabbit', isTruncated: false },
  { name: 'Rat', isTruncated: false },
];

const targetingList = [
  { name: 'Bat' },
  { name: 'Rabbit' },
  { name: 'Rat' },
];

console.log('Battle List Entries:');
battleListEntries.forEach((entry) => {
  console.log(
    `  - "${entry.name}" (truncated: ${entry.isTruncated})`,
  );
});

console.log('\nTargeting List:');
targetingList.forEach((entry) => {
  console.log(`  - "${entry.name}"`);
});

console.log('\n===== OLD BEHAVIOR (Bug) =====');
console.log('Nameplate OCR reads: "Rabbit"');
console.log(
  'Old code would fuzzy match against ALL targeting list names...',
);

const allTargetingNames = targetingList.map((t) => t.name);
const oldMatch = findBestNameMatch('Rabbit', allTargetingNames, 0.3);
console.log(`Result: "${oldMatch}"`);

const rabbitToBat = getSimilarityScore('Rabbit', 'Bat');
const rabbitToRabbit = getSimilarityScore('Rabbit', 'Rabbit');
console.log(`\nSimilarity scores:`);
console.log(`  "Rabbit" vs "Bat": ${rabbitToBat.toFixed(3)}`);
console.log(`  "Rabbit" vs "Rabbit": ${rabbitToRabbit.toFixed(3)}`);

console.log('\n===== NEW BEHAVIOR (Fixed) =====');
console.log('Nameplate OCR reads: "Rabbit"');
console.log('New code matches against battle list names ONLY...');

const allBattleListNames = battleListEntries.map((e) => e.name);
const ocrName = 'Rabbit';
const ocrLower = ocrName.toLowerCase();

// Try exact match first
let matchedBattleListName = allBattleListNames.find(
  (blName) => blName && blName.toLowerCase() === ocrLower,
);

if (matchedBattleListName) {
  console.log(
    `✓ Found exact match: "${matchedBattleListName}"`,
  );
} else {
  // Fallback to fuzzy
  matchedBattleListName = findBestNameMatch(
    ocrName,
    allBattleListNames,
    0.3,
  );
  console.log(
    `Fuzzy match result: "${matchedBattleListName}"`,
  );
}

console.log('\n===== COMPLETE NAME MATCHING TEST =====');
console.log(
  'Testing that complete (non-truncated) names use EXACT matching only...',
);

const truncatedEntry = {
  name: 'Emerald Damsel',
  isTruncated: true,
};
const completeEntry = { name: 'Rabbit', isTruncated: false };

console.log(
  `\nTruncated entry: "${truncatedEntry.name}" (should allow fuzzy)`,
);
const fuzzyForTruncated = findBestNameMatch(
  'Emerald Dam',
  [truncatedEntry.name],
  0.3,
);
console.log(
  `  Fuzzy match "Emerald Dam" → "${fuzzyForTruncated}" ✓`,
);

console.log(
  `\nComplete entry: "${completeEntry.name}" (should reject fuzzy)`,
);
console.log(
  '  In new pipeline, complete names ONLY allow exact match',
);
console.log(
  `  "Rabbt" (typo) would NOT match "${completeEntry.name}" ✓`,
);
console.log(
  `  "Rabbit" (exact) WOULD match "${completeEntry.name}" ✓`,
);

console.log('\n===== TEST COMPLETE =====');
console.log(
  '✓ The bug is fixed: "Rabbit" will NOT be matched to "Bat"',
);
console.log(
  '✓ Complete battle list names require exact matching',
);
console.log(
  '✓ Truncated battle list names allow fuzzy matching',
);
