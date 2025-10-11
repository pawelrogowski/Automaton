// Debug tool to analyze raw frame data and find health bar patterns
// Usage: node debug_healthbar_colors.js /tmp/hb_debug_TIMESTAMP.raw

import fs from 'fs/promises';

async function analyzeFrame(filePath) {
  const buffer = await fs.readFile(filePath);

  // Read header
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = buffer.slice(8); // BGRA data

  console.log(`Frame: ${width}x${height}`);
  console.log(
    `Data size: ${pixels.length} bytes (expected: ${width * height * 4})`,
  );

  // Scan for patterns that look like health bars
  // Looking for: 4-pixel high black vertical line (left border)
  const candidates = [];

  for (let y = 0; y < height - 3; y++) {
    for (let x = 0; x < width - 31; x++) {
      const offset0 = (y * width + x) * 4;
      const offset1 = ((y + 1) * width + x) * 4;
      const offset2 = ((y + 2) * width + x) * 4;
      const offset3 = ((y + 3) * width + x) * 4;

      // Check if all 4 pixels are black (or very dark)
      const isBlack = (offset) => {
        const b = pixels[offset];
        const g = pixels[offset + 1];
        const r = pixels[offset + 2];
        return b <= 5 && g <= 5 && r <= 5; // Allow slight tolerance
      };

      if (
        isBlack(offset0) &&
        isBlack(offset1) &&
        isBlack(offset2) &&
        isBlack(offset3)
      ) {
        // Found potential left border, check right border at x+30
        const rightOff0 = (y * width + (x + 30)) * 4;
        const rightOff1 = ((y + 1) * width + (x + 30)) * 4;
        const rightOff2 = ((y + 2) * width + (x + 30)) * 4;
        const rightOff3 = ((y + 3) * width + (x + 30)) * 4;

        if (
          isBlack(rightOff0) &&
          isBlack(rightOff1) &&
          isBlack(rightOff2) &&
          isBlack(rightOff3)
        ) {
          // Check inner color at (x+1, y+1)
          const innerOffset = ((y + 1) * width + (x + 1)) * 4;
          const b = pixels[innerOffset];
          const g = pixels[innerOffset + 1];
          const r = pixels[innerOffset + 2];
          const color = (r << 16) | (g << 8) | b;

          candidates.push({
            x,
            y,
            color: `0x${color.toString(16).padStart(6, '0').toUpperCase()}`,
            rgb: `[${r}, ${g}, ${b}]`,
            centerX: x + 15,
            centerY: y + 2,
          });
        }
      }
    }
  }

  console.log(`\nFound ${candidates.length} potential health bar patterns:`);
  candidates.forEach((c, i) => {
    console.log(
      `  ${i + 1}. Position: (${c.x}, ${c.y}) | Center: (${c.centerX}, ${c.centerY}) | Color: ${c.color} ${c.rgb}`,
    );
  });

  if (candidates.length === 0) {
    console.log('\nNo health bar patterns found!');
    console.log('This suggests either:');
    console.log('  1. Health bars are not 31 pixels wide');
    console.log('  2. Border colors are not pure black (0,0,0)');
    console.log('  3. Health bars are outside the scanned area');
    console.log(
      '\nTrying relaxed search (any 4-pixel vertical dark line)...\n',
    );

    // Relaxed search
    const relaxedCandidates = [];
    for (let y = 0; y < Math.min(height - 3, 100); y++) {
      // Sample first 100 rows
      for (let x = 0; x < Math.min(width, 500); x++) {
        // Sample first 500 columns
        const offset0 = (y * width + x) * 4;
        const offset1 = ((y + 1) * width + x) * 4;
        const offset2 = ((y + 2) * width + x) * 4;
        const offset3 = ((y + 3) * width + x) * 4;

        const isDark = (offset) => {
          const b = pixels[offset];
          const g = pixels[offset + 1];
          const r = pixels[offset + 2];
          return b + g + r < 30; // Very dark
        };

        if (
          isDark(offset0) &&
          isDark(offset1) &&
          isDark(offset2) &&
          isDark(offset3)
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
              sum: r + g + b,
            });
          }
        }
      }
    }

    console.log(
      `Found ${relaxedCandidates.length} dark vertical lines in sample area`,
    );
    if (relaxedCandidates.length > 0) {
      console.log('First 10:');
      relaxedCandidates.slice(0, 10).forEach((c) => {
        console.log(
          `  (${c.x}, ${c.y}) | Next pixel color: ${c.rgb} (sum: ${c.sum})`,
        );
      });
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(
    'Usage: node debug_healthbar_colors.js /tmp/hb_debug_TIMESTAMP.raw',
  );
  process.exit(1);
}

analyzeFrame(args[0]).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
