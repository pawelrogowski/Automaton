import { parentPort } from 'worker_threads';
import pkg from 'font-ocr';
import { OCR_REGION_CONFIGS, CHAR_PRESETS } from './config.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

// Import both functions from the native module
const { recognizeText, findText } = pkg;

// Track last posted results to avoid redundant updates
const lastPostedResults = new Map();

/**
 * Checks if two rectangle objects intersect.
 */
export function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  )
    return false;

  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

/**
 * Posts a message to the parent only if the payload has changed since last time.
 */
function postUpdateOnce(type, payload) {
  const key = type;
  const prev = lastPostedResults.get(key);
  const payloadString = JSON.stringify(payload);

  if (prev === payloadString) return; // skip redundant update

  lastPostedResults.set(key, payloadString);
  parentPort.postMessage({
    storeUpdate: true,
    type,
    payload,
  });
}

/**
 * Processes the battle list, using OCR and mapping results to entries.
 */
export async function processBattleList(buffer, regions) {
  const battleListEntries = regions.battleList?.children?.entries?.list;
  if (!Array.isArray(battleListEntries) || battleListEntries.length === 0) {
    postUpdateOnce('uiValues/setBattleListEntries', []);
    return;
  }

  try {
    const validNameRegions = battleListEntries
      .filter((e) => e?.name && typeof e.name.x === 'number')
      .map((e) => e.name);
    if (validNameRegions.length === 0) {
      postUpdateOnce('uiValues/setBattleListEntries', []);
      return;
    }

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

    const monsterNameColors = regionDefinitions.battleList?.ocrColors || [];

    const allowedCharsForBattleList = CHAR_PRESETS.ALPHA + ' ';
    const ocrResults =
      recognizeText(
        buffer,
        superRegion,
        monsterNameColors,
        allowedCharsForBattleList,
      ) || [];

    const monsterNames = battleListEntries.map((entry) => {
      if (!entry?.name) return '';
      const foundText = ocrResults.find(
        (ocrLine) => Math.abs(ocrLine.y - entry.name.y) <= 3,
      );
      return foundText ? foundText.text.trim() : '';
    });

    postUpdateOnce('uiValues/setBattleListEntries', monsterNames);
  } catch (ocrError) {
    console.error(
      '[OcrProcessing] OCR failed for battleList entries:',
      ocrError,
    );
  }
}

/**
 * Processes standard OCR regions using their parser and configuration.
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
        let rawData = [];
        const colors = config.colors || [];

        if (config.dictionary && Array.isArray(config.dictionary)) {
          rawData = findText(buffer, region, colors, config.dictionary) || [];
        } else {
          rawData =
            recognizeText(buffer, region, colors, config.allowedChars) || [];
        }

        ocrRawUpdates[regionKey] = rawData;

        if (config.parser) {
          const parsedData = config.parser(rawData);
          if (parsedData) postUpdateOnce(config.storeAction, parsedData);
        }
      } catch (ocrError) {
        console.error(`[OcrProcessing] OCR failed for ${regionKey}:`, ocrError);
      }
    };

    processingPromises.push(processRegion());
  }

  await Promise.all(processingPromises);

  if (Object.keys(ocrRawUpdates).length > 0) {
    postUpdateOnce('ocr/setOcrRegionsText', ocrRawUpdates);
  }
}
