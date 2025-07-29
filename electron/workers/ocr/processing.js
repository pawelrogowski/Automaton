import { parentPort } from 'worker_threads';
import pkg from 'font-ocr';
import { OCR_REGION_CONFIGS } from './config.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

const { recognizeText } = pkg;

/**
 * Checks if two rectangle objects intersect.
 * @returns {boolean} True if the rectangles overlap.
 */
export function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

/**
 * Processes the battle list, which has special logic for handling many small sub-regions.
 * It performs OCR and dispatches the final array of monster names.
 * @param {Buffer} buffer - The shared screen buffer.
 * @param {object} regions - The map of all known UI regions.
 */
export async function processBattleList(buffer, regions) {
  const battleListEntries = regions.battleList?.children?.entries?.list;
  if (!Array.isArray(battleListEntries) || battleListEntries.length === 0) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'uiValues/setBattleListEntries',
      payload: [],
    });
    return;
  }

  try {
    const validNameRegions = battleListEntries
      .filter((e) => e?.name && typeof e.name.x === 'number')
      .map((e) => e.name);
    if (validNameRegions.length === 0) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/setBattleListEntries',
        payload: [],
      });
      return;
    }

    // Create a "super region" that encompasses all monster names for a single, efficient OCR call.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const region of validNameRegions) {
      minX = Math.min(minX, region.x);
      minY = Math.min(minY, region.y);
      maxX = Math.max(maxX, region.x + region.width);
      maxY = Math.max(maxY, region.y + region.height);
    }
    const superRegion = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
    const monsterNameColors = regionDefinitions.battleList?.ocrColors || [
      [240, 240, 240],
    ];

    const ocrResults =
      recognizeText(buffer, superRegion, monsterNameColors) || [];

    // Map the OCR results back to the original battle list entries by their y-coordinate.
    const monsterNames = battleListEntries.map((entry) => {
      if (!entry?.name) return '';
      // Find the OCR line that is vertically closest to the entry's name region.
      const foundText = ocrResults.find(
        (ocrLine) => Math.abs(ocrLine.y - entry.name.y) <= 3,
      );
      return foundText ? foundText.text.trim() : '';
    });

    parentPort.postMessage({
      storeUpdate: true,
      type: 'uiValues/setBattleListEntries',
      payload: monsterNames,
    });
  } catch (ocrError) {
    console.error(
      '[OcrProcessing] OCR failed for battleList entries:',
      ocrError,
    );
  }
}

/**
 * Processes a set of standard OCR regions, running them through their specific parsers.
 * @param {Buffer} buffer - The shared screen buffer.
 * @param {object} regions - The map of all known UI regions.
 * @param {Set<string>} regionKeys - A set of region names to process.
 */
export async function processOcrRegions(buffer, regions, regionKeys) {
  const ocrRawUpdates = {};
  const processingPromises = [];

  for (const regionKey of regionKeys) {
    const config = OCR_REGION_CONFIGS[regionKey];
    const region = regions[regionKey];
    if (!region || !config) continue;

    const processRegion = async () => {
      try {
        // 1. Get raw OCR text data from the native library.
        const rawData = recognizeText(buffer, region, config.colors) || [];
        ocrRawUpdates[regionKey] = rawData; // Keep raw data for debugging if needed.

        // 2. If a parser exists, use it to transform the raw data.
        if (config.parser) {
          const parsedData = config.parser(rawData);

          // 3. If the parser returns a valid result, dispatch the specific, clean action.
          if (parsedData) {
            parentPort.postMessage({
              storeUpdate: true,
              type: config.storeAction,
              payload: parsedData,
            });
          }
        }
      } catch (ocrError) {
        console.error(`[OcrProcessing] OCR failed for ${regionKey}:`, ocrError);
      }
    };
    processingPromises.push(processRegion());
  }

  await Promise.all(processingPromises);

  // This can still be useful for a generic "raw ocr" view in a debug tool.
  if (Object.keys(ocrRawUpdates).length > 0) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'ocr/setOcrRegionsText',
      payload: ocrRawUpdates,
    });
  }
}
