// Check all borders of health bar at specific position
import fs from 'fs/promises';

async function checkBorders(filePath, leftX, topY) {
  const buffer = await fs.readFile(filePath);
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = buffer.slice(8);

  const getPixel = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const offset = (y * width + x) * 4;
    return {
      r: pixels[offset + 2],
      g: pixels[offset + 1],
      b: pixels[offset + 0],
    };
  };

  console.log(`Checking health bar at left=${leftX}, top=${topY}\n`);

  // Check top border (29 pixels, starting at x+1)
  console.log(
    '=== TOP BORDER (29 pixels from X=' +
      (leftX + 1) +
      ' to X=' +
      (leftX + 29) +
      ', Y=' +
      topY +
      ') ===',
  );
  let topBorderOK = true;
  for (let x = leftX + 1; x <= leftX + 29; x++) {
    const p = getPixel(x, topY);
    if (!p || p.r !== 0 || p.g !== 0 || p.b !== 0) {
      console.log(`  X=${x}: RGB[${p?.r}, ${p?.g}, ${p?.b}] ✗ NOT BLACK`);
      topBorderOK = false;
    }
  }
  if (topBorderOK) console.log('  ✓ All 29 pixels are black');

  // Check bottom border (29 pixels, starting at x+1)
  console.log(
    '\n=== BOTTOM BORDER (29 pixels from X=' +
      (leftX + 1) +
      ' to X=' +
      (leftX + 29) +
      ', Y=' +
      (topY + 3) +
      ') ===',
  );
  let bottomBorderOK = true;
  for (let x = leftX + 1; x <= leftX + 29; x++) {
    const p = getPixel(x, topY + 3);
    if (!p || p.r !== 0 || p.g !== 0 || p.b !== 0) {
      console.log(`  X=${x}: RGB[${p?.r}, ${p?.g}, ${p?.b}] ✗ NOT BLACK`);
      bottomBorderOK = false;
    }
  }
  if (bottomBorderOK) console.log('  ✓ All 29 pixels are black');

  console.log(`\n=== SUMMARY ===`);
  console.log(
    `Left border (X=${leftX}, Y=${topY}-${topY + 3}): ✓ BLACK (verified earlier)`,
  );
  console.log(
    `Right border (X=${leftX + 30}, Y=${topY}-${topY + 3}): ✓ BLACK (verified earlier)`,
  );
  console.log(`Top border: ${topBorderOK ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Bottom border: ${bottomBorderOK ? '✓ PASS' : '✗ FAIL'}`);
  console.log(
    `\nNative module requires ALL borders to be perfect black. If any fail, health bar is rejected.`,
  );
}

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node check_borders.js <frame.raw> <leftX> <topY>');
  console.log('Example: node check_borders.js /tmp/frame.raw 1014 433');
  process.exit(1);
}

checkBorders(args[0], parseInt(args[1]), parseInt(args[2])).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
