// Analyze frame dump to find why health bar wasn't detected
// Usage: node analyze_health_bar.js /tmp/hb_mismatch_TIMESTAMP.raw <battleListY>

import fs from 'fs/promises';

async function analyzeFrame(filePath, battleListY) {
  const buffer = await fs.readFile(filePath);

  // Read header
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = buffer.slice(8); // BGRA data

  console.log(`Frame: ${width}x${height}`);
  console.log(`Battle list creature at screen Y: ${battleListY}`);
  console.log(`\nSearching for health bar patterns near Y=${battleListY}...\n`);

  // Health bar should be ABOVE the creature name (which is at battleListY)
  // Typical offset: health bar is ~30-50 pixels above the name
  const searchStartY = Math.max(0, battleListY - 100);
  const searchEndY = Math.min(height - 4, battleListY + 20);

  console.log(`Search range: Y=${searchStartY} to Y=${searchEndY}\n`);

  const isBlack = (offset) => {
    const b = pixels[offset];
    const g = pixels[offset + 1];
    const r = pixels[offset + 2];
    return b === 0 && g === 0 && r === 0;
  };

  const isNearBlack = (offset) => {
    const b = pixels[offset];
    const g = pixels[offset + 1];
    const r = pixels[offset + 2];
    return b <= 5 && g <= 5 && r <= 5;
  };

  // Scan for 4-pixel vertical black columns (potential left borders)
  const candidates = [];

  for (let y = searchStartY; y < searchEndY; y++) {
    for (let x = 0; x < width - 31; x++) {
      const offset0 = (y * width + x) * 4;
      const offset1 = ((y + 1) * width + x) * 4;
      const offset2 = ((y + 2) * width + x) * 4;
      const offset3 = ((y + 3) * width + x) * 4;

      // Check for 4-pixel vertical column (exact black)
      if (
        isBlack(offset0) &&
        isBlack(offset1) &&
        isBlack(offset2) &&
        isBlack(offset3)
      ) {
        // Check right border at x+30
        const rightOff0 = (y * width + (x + 30)) * 4;
        const rightOff1 = ((y + 1) * width + (x + 30)) * 4;
        const rightOff2 = ((y + 2) * width + (x + 30)) * 4;
        const rightOff3 = ((y + 3) * width + (x + 30)) * 4;

        const hasRightBorder =
          isBlack(rightOff0) &&
          isBlack(rightOff1) &&
          isBlack(rightOff2) &&
          isBlack(rightOff3);

        // Get inner color at (x+1, y+1)
        const innerOffset = ((y + 1) * width + (x + 1)) * 4;
        const b = pixels[innerOffset];
        const g = pixels[innerOffset + 1];
        const r = pixels[innerOffset + 2];
        const color = (r << 16) | (g << 8) | b;

        candidates.push({
          x,
          y,
          hasRightBorder,
          innerColor: `0x${color.toString(16).padStart(6, '0').toUpperCase()}`,
          innerRGB: `[${r}, ${g}, ${b}]`,
          distanceFromBattleList: Math.abs(y - battleListY),
        });
      }
    }
  }

  // Also scan for near-black (tolerance 5) in case colors aren't perfect
  const relaxedCandidates = [];
  for (let y = searchStartY; y < searchEndY; y++) {
    for (let x = 0; x < width - 31; x++) {
      const offset0 = (y * width + x) * 4;
      const offset1 = ((y + 1) * width + x) * 4;
      const offset2 = ((y + 2) * width + x) * 4;
      const offset3 = ((y + 3) * width + x) * 4;

      if (
        isNearBlack(offset0) &&
        isNearBlack(offset1) &&
        isNearBlack(offset2) &&
        isNearBlack(offset3)
      ) {
        const innerOffset = ((y + 1) * width + (x + 1)) * 4;
        const b = pixels[innerOffset];
        const g = pixels[innerOffset + 1];
        const r = pixels[innerOffset + 2];

        if (b > 30 || g > 30 || r > 30) {
          // Has some color
          relaxedCandidates.push({
            x,
            y,
            rgb: `[${r}, ${g}, ${b}]`,
            leftBorderRGB: [
              `[${pixels[offset0 + 2]}, ${pixels[offset0 + 1]}, ${pixels[offset0]}]`,
              `[${pixels[offset1 + 2]}, ${pixels[offset1 + 1]}, ${pixels[offset1]}]`,
              `[${pixels[offset2 + 2]}, ${pixels[offset2 + 1]}, ${pixels[offset2]}]`,
              `[${pixels[offset3 + 2]}, ${pixels[offset3 + 1]}, ${pixels[offset3]}]`,
            ],
          });
        }
      }
    }
  }

  console.log(`=== EXACT PATTERN MATCHES (strict black borders) ===`);
  if (candidates.length === 0) {
    console.log('NONE FOUND! This is why the native module failed.\n');
  } else {
    candidates.sort(
      (a, b) => a.distanceFromBattleList - b.distanceFromBattleList,
    );
    candidates.slice(0, 10).forEach((c, i) => {
      console.log(
        `${i + 1}. Position: (${c.x}, ${c.y}) | Right border: ${c.hasRightBorder ? 'YES' : 'NO'} | Inner: ${c.innerColor} ${c.innerRGB} | Distance from battle list: ${c.distanceFromBattleList}px`,
      );
    });
  }

  console.log(`\n=== RELAXED SEARCH (near-black, tolerance ±5) ===`);
  if (relaxedCandidates.length === 0) {
    console.log('No vertical dark lines found at all!\n');
  } else {
    console.log(`Found ${relaxedCandidates.length} near-black vertical lines`);
    console.log('First 10 closest to battle list Y:');
    relaxedCandidates
      .sort((a, b) => Math.abs(a.y - battleListY) - Math.abs(b.y - battleListY))
      .slice(0, 10)
      .forEach((c, i) => {
        console.log(
          `${i + 1}. (${c.x}, ${c.y}) | Inner: ${c.rgb} | Left border pixels: ${c.leftBorderRGB.join(', ')}`,
        );
      });
  }

  // Sample pixels around battle list Y position
  console.log(`\n=== PIXEL SAMPLING around battle list Y=${battleListY} ===`);
  const sampleY = battleListY - 40; // Where health bar should typically be
  console.log(`Sampling row Y=${sampleY} (40px above battle list name):`);

  for (let x = 300; x < 800; x += 50) {
    const offset = (sampleY * width + x) * 4;
    const b = pixels[offset];
    const g = pixels[offset + 1];
    const r = pixels[offset + 2];
    console.log(`  X=${x}: RGB[${r}, ${g}, ${b}]`);
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node analyze_health_bar.js <frame.raw> <battleListY>');
  console.log(
    'Example: node analyze_health_bar.js /tmp/hb_mismatch_1234.raw 22',
  );
  process.exit(1);
}

const filePath = args[0];
const battleListY = parseInt(args[1], 10);

analyzeFrame(filePath, battleListY).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
