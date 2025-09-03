// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/processing.js
// --- CORRECTED ---

import { parentPort } from 'worker_threads';
import pkg from 'font-ocr';
import { OCR_REGION_CONFIGS, CHAR_PRESETS } from './config.js';
import regionDefinitions from '../../constants/regionDefinitions.js';

const { recognizeText, findText } = pkg;
const lastPostedResults = new Map();

// --- UTILITIES ---

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

function postUpdateOnce(type, payload) {
  const key = type;
  const prev = lastPostedResults.get(key);
  const payloadString = JSON.stringify(payload);

  if (prev === payloadString) return;

  lastPostedResults.set(key, payloadString);
  parentPort.postMessage({
    storeUpdate: true,
    type,
    payload,
  });
}

// --- SPECIALIZED REGION PROCESSORS ---

/**
 * Performs a single, bulk OCR scan on the battle list and dispatches the final
 * list of creature names directly to the battleList slice.
 */
export async function processBattleListOcr(buffer, regions) {
  const entriesRegion = regions.battleList?.children?.entries;
  if (!entriesRegion || entriesRegion.height <= 0) {
    // --- CORRECTED ACTION TYPE ---
    postUpdateOnce('battleList/setBattleListEntries', []);
    return;
  }

  try {
    const ocrConfig = {
      colors: regionDefinitions.battleList?.ocrColors || [],
      allowedChars: CHAR_PRESETS.ALPHA + ' ',
    };

    const ocrResults =
      recognizeText(
        buffer,
        entriesRegion,
        ocrConfig.colors,
        ocrConfig.allowedChars,
      ) || [];

    // Create a simple array of names, sorted by their vertical position.
    const creatureNames = ocrResults
      .sort((a, b) => a.y - b.y)
      .map((result) => result.text.trim())
      .filter(Boolean);

    // --- CORRECTED ACTION TYPE ---
    // This now correctly matches the reducer in battleListSlice.js
    postUpdateOnce('battleList/setBattleListEntries', creatureNames);
  } catch (ocrError) {
    console.error(
      '[OcrProcessing] OCR failed for battleList region:',
      ocrError,
    );
  }
}

/**
 * Processes the player list region to extract player names.
 */
export async function processPlayerList(buffer, regions) {
  const playerListRegion = regions.playerList;
  if (
    !playerListRegion ||
    !playerListRegion.x ||
    !playerListRegion.y ||
    playerListRegion.width <= 0 ||
    playerListRegion.height <= 0
  ) {
    postUpdateOnce('uiValues/setPlayers', []);
    return;
  }

  try {
    const playerOcrColors = regionDefinitions.playerList?.ocrColors || [];
    const allowedCharsForPlayerList = CHAR_PRESETS.ALPHA + ' ';

    const ocrResults =
      recognizeText(
        buffer,
        playerListRegion,
        playerOcrColors,
        allowedCharsForPlayerList,
      ) || [];

    const playerNames = ocrResults
      .map((result) => result.text.trim())
      .filter((name) => name.length > 0);

    postUpdateOnce('uiValues/setPlayers', playerNames);
  } catch (ocrError) {
    console.error(
      '[OcrProcessing] OCR failed for playerList entries:',
      ocrError,
    );
  }
}

// --- GENERIC OCR REGION PROCESSING ---

export async function processOcrRegions(buffer, regions, regionKeys) {
  const ocrRawUpdates = {};
  const processingPromises = [];

  if (regionKeys.has('playerList')) {
    processingPromises.push(processPlayerList(buffer, regions));
  }

  for (const regionKey of regionKeys) {
    if (regionKey === 'playerList') continue;

    const cfg = OCR_REGION_CONFIGS[regionKey];
    const region = regions[regionKey];
    if (!region || !cfg) continue;

    const processRegion = async () => {
      try {
        let rawData = [];
        const colors = cfg.colors || [];

        if (cfg.dictionary && Array.isArray(cfg.dictionary)) {
          rawData = findText(buffer, region, colors, cfg.dictionary) || [];
        } else {
          rawData =
            recognizeText(buffer, region, colors, cfg.allowedChars) || [];
        }

        if (regionKey === 'gameWorld') {
          ocrRawUpdates[regionKey] = rawData;
        }

        if (cfg.parser && cfg.storeAction.startsWith('uiValues/')) {
          const parsedData = cfg.parser(rawData);
          if (parsedData) {
            postUpdateOnce(cfg.storeAction, parsedData);
          }
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
