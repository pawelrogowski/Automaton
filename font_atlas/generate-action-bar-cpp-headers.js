import * as fs from 'fs';
import * as path from 'path';
import { actionBarFontData } from './actionBarFontData.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const hOutputPath = path.join(__dirname, '../nativeModules/actionBarOcr/src/actionBarFontData.h');
const cppOutputPath = path.join(__dirname, '../nativeModules/actionBarOcr/src/actionBarFontData.cpp');

function generateHContent() {
  let content = `#ifndef ACTION_BAR_FONT_DATA_H
#define ACTION_BAR_FONT_DATA_H

#include <cstdint>
#include <cstddef>
#include <unordered_map>
#include <array>
#include <vector>

struct Pixel {
    uint8_t x, y, r, g, b;
};

// Color key for lookup
using ColorKey = std::array<uint8_t, 3>;

// Candidate structure for color lookup
struct CandidateInfo {
    int digit;
    size_t pixel_index;
    uint8_t rel_x, rel_y;  // Relative position in template
};

// Hash for array key
struct HashForArray {
  std::size_t operator()(const ColorKey& key) const {
    std::size_t hash = 0;
    for (auto byte : key) {
      hash = hash * 31 + byte;
    }
    return hash;
  }
};

`;
  for (let digit = 0; digit < 10; digit++) {
    content += `// Digit ${digit}
extern const Pixel digit${digit}_pixels[];
extern const size_t digit${digit}_pixel_count;

`;
  }
  content += `
// Precomputed color to candidate lookup
extern const std::unordered_map<ColorKey, std::vector<CandidateInfo>, HashForArray> colorCandidates;

#endif // ACTION_BAR_FONT_DATA_H
`;
  return content;
}

function generateCppContent() {
  let content = `#include "actionBarFontData.h"

  // Background color: RGB(255, 0, 255) - ignored

  `;
  for (let digit = 0; digit < 10; digit++) {
    const charData = actionBarFontData[digit];
    const pixels = charData.pixels.sort((a, b) => a.y - b.y || a.x - b.x);
    content += `// Digit ${digit}
const Pixel digit${digit}_pixels[] = {
  `;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      content += `  {${p.x}, ${p.y}, ${p.r}, ${p.g}, ${p.b}`;
      if (i < pixels.length - 1) {
        content += ',';
      }
      content += '},\n';
    }
    content += `};
const size_t digit${digit}_pixel_count = ${pixels.length};

  `;
  }

  // Generate colorCandidates map
  const colorToCandidates = new Map();
  for (let digit = 0; digit < 10; digit++) {
    const pixels = actionBarFontData[digit].pixels;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      const colorKey = [p.r, p.g, p.b];
      const keyStr = colorKey.join(',');
      if (!colorToCandidates.has(keyStr)) {
        colorToCandidates.set(keyStr, []);
      }
      colorToCandidates.get(keyStr).push({
        digit: digit,
        pixel_index: i,
        rel_x: p.x,
        rel_y: p.y
      });
    }
  }

  content += `
// Precomputed color to candidate lookup
const std::unordered_map<ColorKey, std::vector<CandidateInfo>, HashForArray> colorCandidates = {
  `;
  let firstEntry = true;
  for (const [keyStr, candidates] of colorToCandidates) {
    const colorKey = keyStr.split(',').map(Number);
    if (!firstEntry) {
      content += ',\n  ';
    }
    firstEntry = false;
    content += `{ {${colorKey[0]}, ${colorKey[1]}, ${colorKey[2]} }, { `;
    for (let j = 0; j < candidates.length; j++) {
      const cand = candidates[j];
      if (j > 0) content += ', ';
      content += `{ ${cand.digit}, ${cand.pixel_index}, ${cand.rel_x}, ${cand.rel_y} }`;
    }
    content += ` } }`;
  }
  content += `
};
  `;
  return content;
}

try {
  fs.writeFileSync(hOutputPath, generateHContent());
  fs.writeFileSync(cppOutputPath, generateCppContent());
  console.log(`Generated ${hOutputPath} and ${cppOutputPath} successfully.`);
} catch (error) {
  console.error('Error generating C++ headers:', error);
  process.exit(1);
}