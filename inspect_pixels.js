// Inspect pixels around a specific position to see why health bar wasn't detected
// Usage: node inspect_pixels.js <frame.raw> <x> <y>

import fs from 'fs/promises';

async function inspectArea(filePath, centerX, centerY) {
  const buffer = await fs.readFile(filePath);
  
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = buffer.slice(8);
  
  console.log(`Frame: ${width}x${height}`);
  console.log(`Inspecting area around (${centerX}, ${centerY}) where health bar was expected\n`);
  
  // Health bar is 31px wide, 4px tall
  // Center at (centerX, centerY) means left border should be at approximately (centerX - 15, centerY - 2)
  const expectedLeftX = centerX - 15;
  const expectedTopY = centerY - 2;
  
  console.log(`Expected health bar pattern:`);
  console.log(`  Left border: X=${expectedLeftX}, Y=${expectedTopY} to ${expectedTopY + 3}`);
  console.log(`  Right border: X=${expectedLeftX + 30}, Y=${expectedTopY} to ${expectedTopY + 3}`);
  console.log(`  Width: 31px, Height: 4px\n`);
  
  // Function to get pixel RGB
  const getPixel = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    const offset = (y * width + x) * 4;
    return {
      r: pixels[offset + 2],
      g: pixels[offset + 1],
      b: pixels[offset + 0],
      a: pixels[offset + 3]
    };
  };
  
  // Check the expected left border (4 pixels vertical)
  console.log(`=== LEFT BORDER CHECK (X=${expectedLeftX}) ===`);
  for (let y = expectedTopY; y < expectedTopY + 4; y++) {
    const p = getPixel(expectedLeftX, y);
    if (!p) {
      console.log(`  Y=${y}: OUT OF BOUNDS`);
    } else {
      const isBlack = p.r === 0 && p.g === 0 && p.b === 0;
      console.log(`  Y=${y}: RGB[${p.r}, ${p.g}, ${p.b}] ${isBlack ? '✓ BLACK' : '✗ NOT BLACK'}`);
    }
  }
  
  // Check the expected right border
  console.log(`\n=== RIGHT BORDER CHECK (X=${expectedLeftX + 30}) ===`);
  for (let y = expectedTopY; y < expectedTopY + 4; y++) {
    const p = getPixel(expectedLeftX + 30, y);
    if (!p) {
      console.log(`  Y=${y}: OUT OF BOUNDS`);
    } else {
      const isBlack = p.r === 0 && p.g === 0 && p.b === 0;
      console.log(`  Y=${y}: RGB[${p.r}, ${p.g}, ${p.b}] ${isBlack ? '✓ BLACK' : '✗ NOT BLACK'}`);
    }
  }
  
  // Check inner pixel (should be health bar color)
  console.log(`\n=== INNER COLOR CHECK (X=${expectedLeftX + 1}, Y=${expectedTopY + 1}) ===`);
  const inner = getPixel(expectedLeftX + 1, expectedTopY + 1);
  if (!inner) {
    console.log('OUT OF BOUNDS');
  } else {
    const color = (inner.r << 16) | (inner.g << 8) | inner.b;
    console.log(`  RGB[${inner.r}, ${inner.g}, ${inner.b}] = 0x${color.toString(16).padStart(6, '0').toUpperCase()}`);
    
    // Check if it matches known health bar colors
    const knownColors = {
      0x00C000: 'Full (green)',
      0x60C060: 'High (light green)',
      0xC0C000: 'Medium (yellow)',
      0xC00000: 'Low (red)',
      0xC03030: 'Low (light red)',
      0x600000: 'Critical (dark red)',
      0x000000: 'Empty (black)',
      0xC0C0C0: 'Obstructed (gray)'
    };
    
    if (knownColors[color]) {
      console.log(`  ✓ MATCHES: ${knownColors[color]}`);
    } else {
      console.log(`  ✗ NOT A KNOWN HEALTH BAR COLOR`);
    }
  }
  
  // Show a 41x14 pixel grid around the center (health bar + some context)
  console.log(`\n=== PIXEL GRID (31x4 health bar + 5px margin) ===`);
  console.log(`Showing area from (${expectedLeftX - 5}, ${expectedTopY - 5}) to (${expectedLeftX + 35}, ${expectedTopY + 8})\n`);
  
  for (let y = expectedTopY - 5; y < expectedTopY + 9; y++) {
    let line = `Y=${y.toString().padStart(3)}: `;
    for (let x = expectedLeftX - 5; x < expectedLeftX + 36; x++) {
      const p = getPixel(x, y);
      if (!p) {
        line += '.... ';
      } else {
        // Show first char of hex for each channel
        const code = p.r === 0 && p.g === 0 && p.b === 0 ? '█' : 
                     (p.r + p.g + p.b) < 30 ? '▓' :
                     (p.r + p.g + p.b) < 100 ? '▒' :
                     (p.r + p.g + p.b) < 200 ? '░' : '·';
        line += code;
      }
    }
    
    // Mark the expected health bar area
    const relY = y - expectedTopY;
    if (relY >= 0 && relY < 4) {
      line += ' ← Expected health bar row';
    } else if (relY === -1) {
      line += ' ← Above health bar';
    }else if (relY === 4) {
      line += ' ← Below health bar';
    }
    
    console.log(line);
  }
  
  console.log(`\nLegend: █=black  ▓=very dark  ▒=dark  ░=gray  ·=light`);
}

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node inspect_pixels.js <frame.raw> <x> <y>');
  console.log('Example: node inspect_pixels.js /tmp/hb_mismatch_1234.raw 1029 428');
  process.exit(1);
}

const filePath = args[0];
const x = parseInt(args[1], 10);
const y = parseInt(args[2], 10);

inspectArea(filePath, x, y).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
