import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
  equippedItems,
} from '../constants/index.js';
import { setNotPossibleTimestamp, setThereIsNoWayTimestamp } from '../../frontend/redux/slices/statusMessagesSlice.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import findSequences from 'find-sequences-native';
import fontOcr from 'font-ocr';
import fontAtlasData from '../../font_atlas/font-data.js';

// --- Worker Configuration ---
const { sharedData } = workerData;

// --- Shared Buffer Setup ---
if (!sharedData) throw new Error('[ScreenMonitor] Shared data not provided.');
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0,
  WIDTH_INDEX = 1,
  HEIGHT_INDEX = 2,
  IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8;

// --- State Variables ---
let state = null; // This will be the full Redux state
let lastProcessedFrameCounter = -1;
let lastKnownGoodHealthPercentage = null;
let lastKnownGoodManaPercentage = null;
let lastNotPossibleTimestamp = 0;
let lastThereIsNoWayTimestamp = 0;
const MESSAGE_UPDATE_INTERVAL = 300;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

function getPartyData(partyListRegion, buffer, metadata) {
  if (!partyListRegion || !buffer) return [];
  const partyData = [];
  const approxEntryHeight = 26;
  const maxEntries = Math.floor(partyListRegion.height / approxEntryHeight);
  if (maxEntries <= 0) return [];

  const partyEntryRegions = calculatePartyEntryRegions({ x: 0, y: 0 }, maxEntries);
  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    const absoluteBarCoords = { x: partyListRegion.x + entry.bar.x, y: partyListRegion.y + entry.bar.y };
    const hppc = calculatePartyHpPercentage(buffer, metadata, absoluteBarCoords, resourceBars.partyEntryHpBar, 130);
    if (hppc >= 0) {
      partyData.push({ id: i, hppc, uhCoordinates: entry.uhCoordinates, isActive: true });
    }
  }
  return partyData;
}

function runRules(ruleInput) {
  const currentPreset = state?.rules?.presets?.[state?.rules?.activePresetIndex];
  if (!currentPreset) return;
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Rule processing error:', error);
  }
}

async function mainLoop() {
  console.log('[ScreenMonitor] Worker main loop started.');

  while (true) {
    try {
      Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastProcessedFrameCounter, 200);
      const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

      if (newFrameCounter <= lastProcessedFrameCounter) continue;

      if (!state || !state.regionCoordinates || Object.keys(state.regionCoordinates.regions).length === 0) {
        lastProcessedFrameCounter = newFrameCounter;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      const width = Atomics.load(syncArray, WIDTH_INDEX);
      const height = Atomics.load(syncArray, HEIGHT_INDEX);
      if (width === 0 || height === 0) continue;

      const bufferSize = HEADER_SIZE + width * height * 4;
      const bufferView = Buffer.from(imageSAB, 0, bufferSize);
      const metadata = { width, height, frameCounter: newFrameCounter };
      const { regions } = state.regionCoordinates;

      const searchTasks = {};
      if (regions.cooldowns)
        searchTasks.cooldowns = { sequences: cooldownColorSequences, searchArea: regions.cooldowns, occurrence: 'first' };
      if (regions.statusBar) searchTasks.statusBar = { sequences: statusBarSequences, searchArea: regions.statusBar, occurrence: 'first' };
      if (regions.amuletSlot) searchTasks.amulet = { sequences: equippedItems, searchArea: regions.amuletSlot, occurrence: 'first' };
      if (regions.ringSlot) searchTasks.ring = { sequences: equippedItems, searchArea: regions.ringSlot, occurrence: 'first' };
      if (regions.bootsSlot) searchTasks.boots = { sequences: equippedItems, searchArea: regions.bootsSlot, occurrence: 'first' };
      if (regions.onlineMarker)
        searchTasks.onlineMarker = {
          sequences: { onlineMarker: regionColorSequences.onlineMarker },
          searchArea: regions.onlineMarker,
          occurrence: 'first',
        };
      if (regions.chatOff)
        searchTasks.chatOff = { sequences: { chatOff: regionColorSequences.chatOff }, searchArea: regions.chatOff, occurrence: 'first' };
      if (regions.overallActionBars)
        searchTasks.actionItems = { sequences: actionBarItems, searchArea: regions.overallActionBars, occurrence: 'first' };
      if (regions.battleList)
        searchTasks.battleList = {
          sequences: { battleEntry: battleListSequences.battleEntry },
          searchArea: regions.battleList,
          occurrence: 'all',
        };

      const searchResults = findSequences.findSequencesNativeBatch(bufferView, searchTasks);

      if (regions.gameLog) {
        const detectedText = fontOcr.recognizeText(bufferView, regions.gameLog);
        console.log(detectedText);
        if (detectedText) {
          const now = Date.now();
          if (detectedText.includes('Sorry, not possible.')) {
            if (now - lastNotPossibleTimestamp > MESSAGE_UPDATE_INTERVAL) {
              parentPort.postMessage({ storeUpdate: true, type: setNotPossibleTimestamp.type });
              lastNotPossibleTimestamp = now;
            }
          } else if (detectedText.includes('There is no way.')) {
            if (now - lastThereIsNoWayTimestamp > MESSAGE_UPDATE_INTERVAL) {
              parentPort.postMessage({ storeUpdate: true, type: setThereIsNoWayTimestamp.type });
              lastThereIsNoWayTimestamp = now;
            }
          }
        }
      }

      const { newHealthPercentage, newManaPercentage } =
        regions.healthBar && regions.manaBar
          ? {
              newHealthPercentage: calculatePercentages(bufferView, metadata, regions.healthBar, resourceBars.healthBar, 94),
              newManaPercentage: calculatePercentages(bufferView, metadata, regions.manaBar, resourceBars.manaBar, 94),
            }
          : { newHealthPercentage: lastKnownGoodHealthPercentage, newManaPercentage: lastKnownGoodManaPercentage };
      lastKnownGoodHealthPercentage = newHealthPercentage ?? lastKnownGoodHealthPercentage;
      lastKnownGoodManaPercentage = newManaPercentage ?? lastKnownGoodManaPercentage;

      const currentCooldowns = searchResults.cooldowns || {};
      const healingCd = cooldownManager.updateCooldown('healing', !!currentCooldowns.healing);
      const supportCd = cooldownManager.updateCooldown('support', !!currentCooldowns.support);
      const attackCd = cooldownManager.updateCooldown('attack', !!currentCooldowns.attack);
      if (currentCooldowns.attackInactive) cooldownManager.forceDeactivate('attack');
      if (currentCooldowns.healingInactive) cooldownManager.forceDeactivate('healing');
      if (currentCooldowns.supportInactive) cooldownManager.forceDeactivate('support');

      const characterStatus = {};
      Object.keys(statusBarSequences).forEach((key) => {
        characterStatus[key] = !!(searchResults.statusBar || {})[key];
      });

      const equippedItemsResult = {
        amulet: Object.keys(searchResults.amulet || {}).find((key) => searchResults.amulet[key] !== null) || 'Unknown',
        ring: Object.keys(searchResults.ring || {}).find((key) => searchResults.ring[key] !== null) || 'Unknown',
        boots: Object.keys(searchResults.boots || {}).find((key) => searchResults.boots[key] !== null) || 'Unknown',
      };
      if (equippedItemsResult.amulet === 'emptyAmuletSlot') equippedItemsResult.amulet = 'Empty';
      if (equippedItemsResult.ring === 'emptyRingSlot') equippedItemsResult.ring = 'Empty';
      if (equippedItemsResult.boots === 'emptyBootsSlot') equippedItemsResult.boots = 'Empty';

      const currentStateUpdate = {
        hppc: lastKnownGoodHealthPercentage,
        mppc: lastKnownGoodManaPercentage,
        healingCd,
        supportCd,
        attackCd,
        characterStatus,
        monsterNum: (searchResults.battleList || []).length,
        partyMembers: getPartyData(regions.partyList, bufferView, metadata),
        activeActionItems: Object.fromEntries(Object.entries(searchResults.actionItems || {}).filter(([, val]) => val !== null)),
        equippedItems: equippedItemsResult,
        isLoggedIn: !!searchResults.onlineMarker?.onlineMarker,
        isChatOff: !!searchResults.chatOff?.chatOff,
      };
      parentPort.postMessage({ storeUpdate: true, type: 'gameState/updateGameStateFromMonitorData', payload: currentStateUpdate });

      if (state?.global?.isBotEnabled) runRules(currentStateUpdate);
      lastProcessedFrameCounter = newFrameCounter;
    } catch (err) {
      console.error('[ScreenMonitor] Fatal error in main loop:', err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

parentPort.on('message', (message) => {
  state = message;
});

async function startWorker() {
  console.log('[ScreenMonitor] Worker starting up...');

  try {
    await fontOcr.loadFontAtlas(fontAtlasData);
    console.log('[ScreenMonitor] Font atlas loaded.');
  } catch (e) {
    console.error('[ScreenMonitor] CRITICAL: Failed to load font atlas.', e);
  }

  mainLoop();
}

startWorker();
