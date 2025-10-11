#!/usr/bin/env node

/**
 * Extract all sequences from production code for realistic benchmarking
 */

import regionDefinitions from '../electron/constants/regionDefinitions.js';
import actionBarItems from '../electron/constants/actionBarItems.js';
import fs from 'fs';

const sequences = {};

// Extract from regionDefinitions
function extractSequences(obj, prefix = '') {
  if (obj.sequence && Array.isArray(obj.sequence)) {
    sequences[prefix] = {
      sequence: obj.sequence,
      direction: obj.direction || 'horizontal',
    };
  }

  if (obj.children) {
    Object.entries(obj.children).forEach(([key, child]) => {
      extractSequences(child, `${prefix}_${key}`);
    });
  }
}

Object.entries(regionDefinitions).forEach(([key, def]) => {
  extractSequences(def, key);
});

// Add actionBar sequences
Object.entries(actionBarItems).forEach(([key, item]) => {
  if (item.sequence) {
    sequences[`actionBar_${key}`] = {
      sequence: item.sequence,
      direction: item.direction || 'horizontal',
    };
  }
});

console.log(
  `Extracted ${Object.keys(sequences).length} sequences from production code`,
);
console.log('\nBreakdown:');
const regionSeqs = Object.keys(sequences).filter(
  (k) => !k.startsWith('actionBar_'),
).length;
const actionSeqs = Object.keys(sequences).filter((k) =>
  k.startsWith('actionBar_'),
).length;
console.log(`  Region definitions: ${regionSeqs}`);
console.log(`  Action bar items: ${actionSeqs}`);

// Write to file for benchmark tool
fs.writeFileSync(
  './tools/benchmark_sequences.json',
  JSON.stringify(sequences, null, 2),
);

console.log('\nWrote sequences to tools/benchmark_sequences.json');
