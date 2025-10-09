// Convert raw frame dump to PNG image
// Usage: node convert_dump_to_png.js <input.raw> [output.png]

import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

async function convertToPng(inputPath, outputPath) {
  console.log(`Reading ${inputPath}...`);
  const buffer = await fs.readFile(inputPath);
  
  // Read header
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const pixels = buffer.slice(8); // BGRA data
  
  console.log(`Image dimensions: ${width}x${height}`);
  console.log(`Pixel data size: ${pixels.length} bytes (expected: ${width * height * 4})`);
  
  if (pixels.length < width * height * 4) {
    throw new Error('Pixel data is incomplete!');
  }
  
  // Convert BGRA to RGBA (swap B and R channels)
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    rgba[i] = pixels[i + 2];     // R
    rgba[i + 1] = pixels[i + 1]; // G
    rgba[i + 2] = pixels[i];     // B
    rgba[i + 3] = pixels[i + 3]; // A
  }
  
  console.log(`Converting to PNG...`);
  
  // Use sharp to create PNG
  await sharp(rgba, {
    raw: {
      width,
      height,
      channels: 4
    }
  })
  .png()
  .toFile(outputPath);
  
  console.log(`✓ Saved to ${outputPath}`);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: node convert_dump_to_png.js <input.raw> [output.png]');
  console.log('Example: node convert_dump_to_png.js /tmp/hb_mismatch_1234.raw output.png');
  process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1] || inputPath.replace('.raw', '.png');

convertToPng(inputPath, outputPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
