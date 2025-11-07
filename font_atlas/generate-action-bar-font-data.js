import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

async function generateFontData() {
  try {
    const imagePath = path.join(__dirname, 'actionBarNumbers', 'actionBarNumbers.png');
    const raw = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
    const { data, info } = raw;
    console.log('Image info:', info);
    for (let i = 0; i < 10; i++) {
      const offset = i * 4;
      console.log(`Pixel ${i} RGBA:`, data[offset], data[offset+1], data[offset+2], data[offset+3]);
    }
    const height = info.height;
    const width = info.width;

    if (height !== 6 || width !== 58) {
      throw new Error(`Unexpected image dimensions: ${width}x${height}. Expected 58x6.`);
    }

    const backgroundColor = { r: 255, g: 0, b: 255 };
    const fontData = [];

    for (let digit = 0; digit < 10; digit++) {
      const char = String.fromCharCode(48 + digit); // '0' to '9'
      const xStart = digit * 6;
      const pixels = [];

      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 4; x++) {
          const pixelX = xStart + x;
          const offset = (y * width + pixelX) * 4; // RGBA
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          const a = data[offset + 3];

          if (a === 255 && (r !== backgroundColor.r || g !== backgroundColor.g || b !== backgroundColor.b)) {
            pixels.push({
              x: x,
              y: y,
              r: r,
              g: g,
              b: b
            });
          }
        }
      }

      fontData.push({
        value: char,
        pixels: pixels
      });
    }

    const outputPath = path.join(__dirname, 'actionBarFontData.js');
    const jsContent = `export const actionBarFontData = ${JSON.stringify(fontData, null, 2)};`;
    fs.writeFileSync(outputPath, jsContent);

    console.log(`Generated ${outputPath} successfully.`);
  } catch (error) {
    console.error('Error generating font data:', error);
    process.exit(1);
  }
}

generateFontData();