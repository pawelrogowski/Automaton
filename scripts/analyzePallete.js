// analyzePalette.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { createLogger } from '../electron/utils/logger.js'; // Adjust path if needed

const logger = createLogger({ info: true });

const TIBIA_MINIMAP_BASE_PATH = path.join(os.homedir(), '.local', 'share', 'CipSoft GmbH', 'Tibia', 'packages', 'Tibia', 'minimap');
const PALETTE_OUTPUT_PATH = path.join(process.cwd(), 'resources', 'preprocessed_minimaps', 'palette.json');

async function analyzePalette() {
  logger('info', 'Starting minimap palette analysis...');
  logger('info', `Reading from: ${TIBIA_MINIMAP_BASE_PATH}`);

  const uniqueColors = new Set();
  let fileCount = 0;

  try {
    const files = await fs.readdir(TIBIA_MINIMAP_BASE_PATH);
    const minimapPngFiles = files.filter((file) => file.startsWith('Minimap_Color_') && file.endsWith('.png'));
    const totalFiles = minimapPngFiles.length;

    for (const file of minimapPngFiles) {
      fileCount++;
      const inputFilePath = path.join(TIBIA_MINIMAP_BASE_PATH, file);

      try {
        const { data } = await sharp(inputFilePath).raw().toBuffer({ resolveWithObject: true });

        // Iterate over each RGB pixel
        for (let i = 0; i < data.length; i += 3) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Use a string key for the Set to ensure uniqueness
          uniqueColors.add(`${r},${g},${b}`);
        }

        if (fileCount % 100 === 0) {
          logger('info', `Processed ${fileCount} / ${totalFiles} files. Found ${uniqueColors.size} unique colors so far.`);
        }
      } catch (error) {
        logger('error', `Could not process file ${file}: ${error.message}`);
      }
    }

    const colorCount = uniqueColors.size;
    logger('info', `Analysis complete! Found a total of ${colorCount} unique colors.`);

    // Convert the Set of strings to a more usable array of objects
    const palette = Array.from(uniqueColors).map((colorString) => {
      const [r, g, b] = colorString.split(',').map(Number);
      return { r, g, b };
    });

    // Sort the palette for consistency. This isn't required but is good practice.
    palette.sort((a, b) => a.r - b.r || a.g - b.g || a.b - b.b);

    await fs.mkdir(path.dirname(PALETTE_OUTPUT_PATH), { recursive: true });
    await fs.writeFile(PALETTE_OUTPUT_PATH, JSON.stringify(palette, null, 2));

    logger('info', `Palette saved to ${PALETTE_OUTPUT_PATH}`);
  } catch (error) {
    logger('error', `Failed during analysis: ${error.message}`);
  }
}

analyzePalette().catch((err) => logger('error', `Fatal error: ${err.message}`));
