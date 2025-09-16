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
    if (playerNames.length > 0) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenPlayerMs',
      });
    }
  } catch (ocrError) {
    console.error(
      '[OcrProcessing] OCR failed for playerList entries:',
      ocrError,
    );
  }
}

/**
 * Processes the NPC list region to extract NPC names.
 */
export async function processNpcList(buffer, regions) {
  const npcListRegion = regions.npcList;
  if (
    !npcListRegion ||
    !npcListRegion.x ||
    !npcListRegion.y ||
    npcListRegion.width <= 0 ||
    npcListRegion.height <= 0
  ) {
    postUpdateOnce('uiValues/setNpcs', []);
    return;
  }

  try {
    const npcOcrColors = regionDefinitions.npcList?.ocrColors || [];
    const allowedCharsForNpcList = CHAR_PRESETS.ALPHA + ' ';

    const ocrResults =
      recognizeText(
        buffer,
        npcListRegion,
        npcOcrColors,
        allowedCharsForNpcList,
      ) || [];

    const npcNames = ocrResults
      .map((result) => result.text.trim())
      .filter((name) => name.length > 0);

    postUpdateOnce('uiValues/setNpcs', npcNames);
    if (npcNames.length > 0) {
      parentPort.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenNpcMs',
      });
    }
  } catch (ocrError) {
    console.error('[OcrProcessing] OCR failed for npcList entries:', ocrError);
  }
}

// --- GENERIC OCR REGION PROCESSING ---

export async function processOcrRegions(buffer, regions, regionKeys) {
  const ocrRawUpdates = {};
  const processingPromises = [];

  if (regionKeys.has('playerList')) {
    processingPromises.push(processPlayerList(buffer, regions));
  }

  if (regionKeys.has('npcList')) {
    processingPromises.push(processNpcList(buffer, regions));
  }

  for (const regionKey of regionKeys) {
    if (regionKey === 'playerList' || regionKey === 'npcList') continue;

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
