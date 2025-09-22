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

// --- GENERIC OCR REGION PROCESSING ---

export async function processOcrRegions(buffer, regions, regionKeys) {
  const ocrRawUpdates = {};
  const processingPromises = [];

  for (const regionKey of regionKeys) {
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
