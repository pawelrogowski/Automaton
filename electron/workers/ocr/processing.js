// /home/feiron/Dokumenty/Automaton/electron/workers/ocr/processing.js
// --- REFACTORED ---

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

// --- BATTLE LIST PROCESSING (RESTORED DEDICATED LOGIC) ---

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

    // Create a "super region" that contains all nameplates to optimize the native call
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

    // Map the OCR results back to the individual entries based on vertical position
    const monsterNames = battleListEntries.map((entry) => {
      if (!entry?.name) return '';
      // Find the OCR line that is vertically aligned with the entry's nameplate
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

// --- PLAYER LIST PROCESSING ---

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
    const PLAYER_LIST_ENTRY_HEIGHT = 12; // Approximate height of a player name entry
    const PLAYER_LIST_ENTRY_VERTICAL_PITCH = 14; // Approximate vertical distance between entries

    const maxEntries = Math.floor(
      (playerListRegion.height +
        (PLAYER_LIST_ENTRY_VERTICAL_PITCH - PLAYER_LIST_ENTRY_HEIGHT)) /
        PLAYER_LIST_ENTRY_VERTICAL_PITCH,
    );

    if (maxEntries <= 0) {
      postUpdateOnce('uiValues/setPlayers', []);
      return;
    }

    const playerNameRegions = [];
    for (let i = 0; i < maxEntries; i++) {
      const entryBaseY =
        playerListRegion.y + i * PLAYER_LIST_ENTRY_VERTICAL_PITCH;
      playerNameRegions.push({
        x: playerListRegion.x,
        y: entryBaseY,
        width: playerListRegion.width,
        height: PLAYER_LIST_ENTRY_HEIGHT,
      });
    }

    // Create a "super region" that contains all nameplates to optimize the native call
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const region of playerNameRegions) {
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

    const playerOcrColors = regionDefinitions.playerList?.ocrColors || [];
    const allowedCharsForPlayerList = CHAR_PRESETS.ALPHA + ' ';

    const ocrResults =
      recognizeText(
        buffer,
        superRegion,
        playerOcrColors,
        allowedCharsForPlayerList,
      ) || [];

    const playerNames = playerNameRegions
      .map((entryRegion) => {
        const foundText = ocrResults.find(
          (ocrLine) => Math.abs(ocrLine.y - entryRegion.y) <= 3,
        );
        return foundText ? foundText.text.trim() : '';
      })
      .filter((name) => name.length > 0); // Filter out empty names

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

  // Process playerList specifically
  processingPromises.push(processPlayerList(buffer, regions));

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
