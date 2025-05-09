// screenMonitor.js
import { parentPort, workerData, isMainThread } from 'worker_threads';
import { createRequire } from 'module';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems, // Object: { itemName: { sequence, direction, categories?, name? } }
  equippedItems,
} from '../constants/index.js'; // Assuming path relative to worker file location

import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { extractSubBuffer } from '../screenMonitor/screenGrabUtils/extractSubBuffer.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { config, MINIMAP_CHANGE_INTERVAL, GET_FRAME_RETRY_DELAY, GET_FRAME_MAX_RETRIES } from './screenMonitor/modules/config.js'; // Import config and constants
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js'; // Import utils

// --- Dependencies ---
const require = createRequire(import.meta.url);
const x11capturePath = workerData?.x11capturePath || '';
const findSequencesPath = workerData?.findSequencesPath || '';

let X11Capture = null;
let findSequencesNative = null;

// Load Native Modules
try {
    if (x11capturePath) ({ X11Capture } = require(x11capturePath));
    else throw new Error('x11capturePath not provided in workerData');
} catch(e) {
    console.error("FATAL: Failed to load X11Capture native module:", e);
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load X11Capture module' });
    process.exit(1);
}
try {
    if (findSequencesPath) ({ findSequencesNative } = require(findSequencesPath));
    else throw new Error('findSequencesPath not provided in workerData');
} catch(e) {
    console.error("FATAL: Failed to load findSequencesNative module:", e);
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load findSequencesNative module' });
    process.exit(1);
}


// --- State Variables ---
let state = null;
let initialized = false;
let shouldRestart = false;
let dimensions = null;
let lastDimensions = null;

let currentFrameData = null;
let startRegions = null;
// Specific region definitions
let hpManaRegion = null;
let cooldownsRegion = null;
let statusBarRegion = null;
let minimapRegion = null;
let battleListRegion = null;
let partyListRegion = null;
let overallActionBarsRegion = null;
let amuletSlotRegion = null;
let ringSlotRegion = null;

let initialActionItemsCountForNotification = 0;
let detectedAmulet = null;
let detectedRing = null;
// HP/MP bar coordinates
let hpbar = null;
let mpbar = null;
// Minimap change detection
let lastMinimapData = null;
let lastMinimapChangeTime = null;
let minimapChanged = false;

let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
let previousActionItemCount = -1;
let consecutiveFrameFailures = 0;
const MAX_CONSECUTIVE_FRAME_FAILURES = 10;

let currentWindowId = null;
let currentRefreshRate = null;
let successfulFramesThisSecond = 0;
let lastFpsLogTime = Date.now();
let lastDispatchedFps = 0;
let lastSuccessfulFrameTime = 0;


// --- Instances ---
const captureInstance = X11Capture ? new X11Capture() : null;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

// --- Helper Functions ---


async function dispatchHealthUpdate(percentage) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setHealthPercent',
    payload: { hpPercentage: percentage },
  });
}


async function dispatchManaUpdate(percentage) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setManaPercent',
    payload: { manaPercentage: percentage },
  });
}

async function dispatchFpsUpdate(fps) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setActualFps',
    payload: { actualFps: fps },
  });
}


function resetRegions() {
  hpManaRegion = null; cooldownsRegion = null; statusBarRegion = null; minimapRegion = null;
  battleListRegion = null; partyListRegion = null; overallActionBarsRegion = null;
  amuletSlotRegion = null; ringSlotRegion = null;
  currentFrameData = null; startRegions = null; hpbar = null; mpbar = null;
  lastMinimapData = null;
  initialActionItemsCountForNotification = 0;
  detectedAmulet = null; detectedRing = null;
  dimensions = null; lastDimensions = null;
  lastDispatchedHealthPercentage = null; lastDispatchedManaPercentage = null;
  previousActionItemCount = -1;
  consecutiveFrameFailures = 0;
  lastDispatchedFps = 0;
  lastSuccessfulFrameTime = 0;
}


function findBoundingRegionHelper(startSequence, endSequence, width, height) {
  if (!currentFrameData || !currentFrameData.data || !dimensions || !startSequence || !endSequence) {
      if(config.logging.logRegionCaptureFailures) console.warn('findBoundingRegionHelper: Missing required data');
      return null;
  }
  if (typeof findSequencesNative !== 'function') {
       console.error("findBoundingRegionHelper: findSequencesNative is not loaded!");
       return null;
  }
  try {
      const result = findBoundingRect(
          findSequencesNative,
          currentFrameData.data,
          startSequence,
          endSequence,
          width ?? dimensions.width,
          height ?? dimensions.height
      );
      return result.startFound && result.endFound && result.width > 0 && result.height > 0 ? result : null;
  } catch (error) {
      console.error('Error in findBoundingRegionHelper:', error);
      return null;
  }
}


function clampFps(fps) {
    const rate = parseInt(fps, 10);
    if (isNaN(rate)) {
        console.warn(`Invalid refreshRate received: ${fps}. Defaulting to 20.`);
        return 20;
    }
    return Math.max(10, Math.min(60, rate));
}


async function initializeRegions() {
  if (!state?.global?.windowId) { console.error('Cannot initialize: windowId missing.'); initialized = false; shouldRestart = true; return; }
  if (!captureInstance || !findSequencesNative) { console.error('Cannot initialize: Native module missing.'); initialized = false; shouldRestart = true; return; }
  if (typeof state?.global?.refreshRate !== 'number') { console.error('Cannot initialize: refreshRate missing or invalid.'); initialized = false; shouldRestart = true; return; }

  if (config.logging.logInitialization) console.log('[Init] Starting region initialization...');
  resetRegions();

  try { // For startContinuousCapture
    const windowId = state.global.windowId;
    const targetFps = clampFps(state.global.refreshRate);
    currentRefreshRate = targetFps;
    if (config.logging.logInitialization) console.log(`[Init] Ensuring continuous capture is started for window ${windowId} at ${targetFps} FPS...`);
    captureInstance.startContinuousCapture(windowId, targetFps);
    await delay(50);
  } catch (startError) {
     if (startError instanceof RangeError) {
       console.error(`[Init] FATAL: Invalid targetFps provided to startContinuousCapture: ${state.global.refreshRate}. Error: ${startError.message}`);
       if (parentPort) parentPort.postMessage({ fatalError: `Invalid refreshRate ${state.global.refreshRate}` });
       process.exit(1);
     }
      console.warn(`[Init] Warning during startContinuousCapture: ${startError.message}`);
      initialized = false; shouldRestart = true; resetRegions();
      return;
  }

  if (config.logging.logInitialization) console.log('[Init] Attempting to get initial frame for dimensions...');
  let retries = 0; currentFrameData = null;
  while (!currentFrameData && retries < GET_FRAME_MAX_RETRIES) {
      currentFrameData = captureInstance.getLatestFrame();
      if (!currentFrameData) {
          retries++;
          if (config.logging.logInitialization) console.log(`[Init] Initial frame not ready, retry ${retries}/${GET_FRAME_MAX_RETRIES}...`);
          await delay(GET_FRAME_RETRY_DELAY * (retries + 1));
      }
  }
  if (!currentFrameData || !currentFrameData.data) {
      throw new Error(`Failed to get initial window frame after ${GET_FRAME_MAX_RETRIES} retries.`);
  }

  dimensions = { width: currentFrameData.width, height: currentFrameData.height };
  lastDimensions = { ...dimensions };
  if (config.logging.logInitialization) console.log(`[Init] Dimensions from first frame: ${dimensions.width}x${dimensions.height}`);

  try { // Main initialization logic try block
    if (config.logging.logInitialization) console.log('[Init] Finding initial layout regions...');
    startRegions = findSequencesNative(currentFrameData.data, regionColorSequences, null, "first");
    if (!startRegions || typeof startRegions !== 'object') {
        throw new Error('Failed to find start regions or invalid result from findSequencesNative.');
    }
    if (config.logging.logInitialization) {
        const foundKeys = Object.keys(startRegions).filter(k => startRegions[k]).join(', ');
        const equipmentKeys = ['amuletSlot', 'ringSlot'].filter(k => startRegions[k]).join(', ');
        console.log(`[Init] Layout regions found: ${foundKeys}${equipmentKeys ? ', ' + equipmentKeys : ''}`);
    }

    initializeStandardRegions();
    initializeSpecialRegions(currentFrameData.data);

    if (!hpManaRegion) {
      throw new Error('Essential region (HP/Mana) failed to initialize.');
    }
    if (config.logging.logRegionCaptureFailures) {
        if (!cooldownsRegion) console.warn('[Init] Cooldowns region failed.');
        if (!statusBarRegion) console.warn('[Init] Status bar region failed.');
        if (!minimapRegion) console.warn('[Init] Minimap region failed.');
        if (config.captureRegions.battleList.enabled && !battleListRegion) console.warn('[Init] Battle list region failed.');
        if (config.captureRegions.partyList.enabled && !partyListRegion) console.warn('[Init] Party list region failed.');
        if (config.captureRegions.actionBars.enabled && !overallActionBarsRegion) console.warn('[Init] Action bars region failed.');
        if (!amuletSlotRegion) console.warn('[Init] Amulet slot region failed.');
        if (!ringSlotRegion) console.warn('[Init] Ring slot region failed.');
    }

    initialized = true;
    shouldRestart = false;
    if (config.logging.logInitialization) console.log('[Init] Region initialization successful.');
    notifyInitializationStatus();
    successfulFramesThisSecond = 0;
    lastFpsLogTime = Date.now();
    lastSuccessfulFrameTime = 0;

  } catch (error) { // Catch for main initialization logic
    console.error('[Init] Error during region initialization:', error);
    initialized = false;
    shouldRestart = true;
    dimensions = null; lastDimensions = null;
    currentRefreshRate = null;
    resetRegions();
    if (captureInstance && state?.global?.windowId) {
        try { captureInstance.stopContinuousCapture(); } catch (e) { /* Ignore */ }
    }
  }
}


function initializeStandardRegions() {
  if (!startRegions || !dimensions) { console.warn('Cannot initialize standard regions: missing data'); return; }
  const { healthBar, manaBar, cooldownBar, cooldownBarFallback, statusBar, minimap, amuletSlot, ringSlot } = startRegions;

  if (healthBar?.x !== undefined && manaBar?.x !== undefined) {
    hpManaRegion = createRegion(healthBar, 94, 14);
    if (hpManaRegion) {
        hpbar = { x: healthBar.x - hpManaRegion.x, y: healthBar.y - hpManaRegion.y };
        mpbar = { x: manaBar.x - hpManaRegion.x, y: manaBar.y - hpManaRegion.y };
    } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Failed to create hpManaRegion object');
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Health or mana bar marker coordinates missing');

  if (cooldownBar?.x !== undefined || cooldownBarFallback?.x !== undefined) {
    cooldownsRegion = createRegion(cooldownBar || cooldownBarFallback, 56, 4);
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Cooldown bar marker coordinates missing');

  if (statusBar?.x !== undefined) {
    statusBarRegion = createRegion(statusBar, 104, 9);
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Status bar marker coordinates missing');

  if (minimap?.x !== undefined) {
    minimapRegion = createRegion(minimap, 106, 1);
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Minimap marker coordinates missing');

  const slotWidth = 32;
  const slotHeight = 32;

  if (amuletSlot?.x !== undefined) {
    amuletSlotRegion = createRegion(amuletSlot, slotWidth, slotHeight);
    if (!amuletSlotRegion && config.logging.logRegionCaptureFailures) console.warn('[Init] Failed to create amuletSlotRegion object');
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Amulet slot marker coordinates missing');

  if (ringSlot?.x !== undefined) {
    ringSlotRegion = createRegion(ringSlot, slotWidth, slotHeight);
    if (!ringSlotRegion && config.logging.logRegionCaptureFailures) console.warn('[Init] Failed to create ringSlotRegion object');
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Ring slot marker coordinates missing');
}


function initializeSpecialRegions(initialImageData) {
  if (!initialImageData || !dimensions) {
    console.warn('Cannot init special regions: missing data');
    initialActionItemsCountForNotification = 0;
    return;
  }
  initialActionItemsCountForNotification = 0;

  if (config.captureRegions.battleList.enabled) {
    if(config.logging.logInitialization) console.log('[Init] Initializing battle list region...');
    const region = findBoundingRegionHelper(regionColorSequences.battleListStart, regionColorSequences.battleListEnd, 169, dimensions.height);
    battleListRegion = validateRegionDimensions(region) ? region : null;
    if(config.logging.logInitialization) console.log(`[Init] Battle list region ${battleListRegion ? 'found' : 'NOT found'}.`);
  }

  if (config.captureRegions.partyList.enabled) {
     if(config.logging.logInitialization) console.log('[Init] Initializing party list region...');
    const region = findBoundingRegionHelper(regionColorSequences.partyListStart, regionColorSequences.partyListEnd, 169, dimensions.height);
    partyListRegion = validateRegionDimensions(region) ? region : null;
     if(config.logging.logInitialization) console.log(`[Init] Party list region ${partyListRegion ? 'found' : 'NOT found'}.`);
  }

  if (config.captureRegions.actionBars.enabled) {
     if(config.logging.logInitialization) console.log('[Init] Initializing action bars...');
    const region = findBoundingRegionHelper(regionColorSequences.hotkeyBarBottomStart, regionColorSequences.hotkeyBarBottomEnd, dimensions.width, dimensions.height / 2);
    overallActionBarsRegion = validateRegionDimensions(region) ? region : null;

    if (overallActionBarsRegion) {
        if(config.logging.logInitialization) console.log('[Init] Overall action bar region found:', overallActionBarsRegion);
        try {
            if(config.logging.logInitialization) console.log('[Init] Scanning for action items within region for initial count...');
            const initialFoundItemsMap = findSequencesNative(initialImageData, actionBarItems, overallActionBarsRegion, "first");

            if (initialFoundItemsMap) {
                 let count = 0;
                 for (const itemName in initialFoundItemsMap) {
                     if (initialFoundItemsMap[itemName]) {
                         count++;
                     }
                 }
                 initialActionItemsCountForNotification = count;
                 if(config.logging.logInitialization) console.log(`[Init] Found ${initialActionItemsCountForNotification} potential action item locations initially.`);
            } else {
                 if(config.logging.logInitialization) console.log('[Init] No initial action items found in the region.');
            }
        } catch (error) {
            console.error("[Init] Error during initial action item scan:", error);
            overallActionBarsRegion = null;
        }
    } else {
        if(config.logging.logInitialization || config.logging.logRegionCaptureFailures) console.warn("[Init] Could not find overall action bar region.");
    }
  }
}


function notifyInitializationStatus() {
  const status = {
    hpMana: !!hpManaRegion, cooldowns: !!cooldownsRegion, statusBar: !!statusBarRegion, minimap: !!minimapRegion,
    battleList: !!battleListRegion, partyList: !!partyListRegion, actionBars: !!overallActionBarsRegion,
    itemsLocated: initialActionItemsCountForNotification,
    amuletSlot: !!amuletSlotRegion,
    ringSlot: !!ringSlotRegion,
  };

  let body = `Init: HP:${status.hpMana?'✅':'❌'} CD:${status.cooldowns?'✅':'❌'} Status:${status.statusBar?'✅':'❌'} Map:${status.minimap?'✅':'❌'} `
            +`Equip:[Am:${status.amuletSlot?'✅':'❌'} Rg:${status.ringSlot?'✅':'❌'}] `
            +`Battle:${status.battleList?'✅':'❌'} Party:${status.partyList?'✅':'❌'} Actions:${status.actionBars?'✅':'❌'}(${status.itemsLocated})`;
  parentPort.postMessage({ notification: { title: 'Monitor Status', body: body } });
}


function handleResizeStart(newDimensions) {
  console.warn(`Resize detected/triggered. New dimensions: ${newDimensions?.width}x${newDimensions?.height}`);
  dimensions = newDimensions;
  lastDimensions = newDimensions ? { ...newDimensions } : null;
  parentPort.postMessage({ notification: { title: 'Monitor Warning', body: 'Window Size Changed - Re-initializing...' } });
  initialized = false;
  shouldRestart = true;
  resetRegions();
}


function needsInitialization() {
    return (!initialized && state?.global?.windowId && state?.global?.refreshRate) || shouldRestart;
}


function handleMinimapChange(fullFrameDataBuffer, minimapSearchRegion) {
  if (!fullFrameDataBuffer || !validateRegionDimensions(minimapSearchRegion)) {
      return;
  }
  let currentMinimapData = null;
  try {
      currentMinimapData = extractSubBuffer(fullFrameDataBuffer, minimapSearchRegion);
  } catch (error) {
      console.error("handleMinimapChange: Error extracting sub-buffer for minimap:", error);
      return;
  }

  if (lastMinimapData) {
      const minimapIsDifferent = Buffer.compare(currentMinimapData, lastMinimapData) !== 0;
      if (minimapIsDifferent) {
          minimapChanged = true;
          lastMinimapChangeTime = Date.now();
      } else if (minimapChanged && lastMinimapChangeTime && (Date.now() - lastMinimapChangeTime > MINIMAP_CHANGE_INTERVAL)) {
          minimapChanged = false;
          lastMinimapChangeTime = null;
      }
  } else {
      minimapChanged = false;
      lastMinimapChangeTime = null;
      console.log("[Minimap] Initializing...");
  }
  lastMinimapData = currentMinimapData;
}


function processDynamicRegions(frameDataBuffer) {
    const results = { cooldowns: {}, statusBar: {}, actionItems: {}, equipped: {} };
    if (!frameDataBuffer || !findSequencesNative) return results;

    if (config.captureRegions.cooldowns.enabled && cooldownsRegion) {
        try {
            results.cooldowns = findSequencesNative(frameDataBuffer, cooldownColorSequences, cooldownsRegion, "first") || {};
        } catch (e) { console.error("Error finding cooldowns:", e); results.cooldowns = {}; }
    }

    if (config.captureRegions.statusBar.enabled && statusBarRegion) {
        try {
            results.statusBar = findSequencesNative(frameDataBuffer, statusBarSequences, statusBarRegion, "first") || {};
        } catch(e) { console.error("Error finding status bars:", e); results.statusBar = {}; }
    }

    if (config.captureRegions.actionBars.enabled && overallActionBarsRegion) {
         try {
             const rawFoundItemsMap = findSequencesNative(frameDataBuffer, actionBarItems, overallActionBarsRegion, "first") || {};
             const filteredActionItems = {};
             for (const itemName in rawFoundItemsMap) {
                 if (rawFoundItemsMap[itemName]) {
                     filteredActionItems[itemName] = rawFoundItemsMap[itemName];
                 }
             }
             results.actionItems = filteredActionItems;

             const currentActionItemCount = Object.keys(results.actionItems).length;
            //  if (previousActionItemCount !== -1 && currentActionItemCount !== previousActionItemCount) {
            //      parentPort.postMessage({
            //          notification: {
            //              title: 'Monitor Info',
            //              body: `Action Bar Items Changed: ${currentActionItemCount} detected (was ${previousActionItemCount})`
            //          }
            //      });
            //  }
             previousActionItemCount = currentActionItemCount;

             if (config.logging.logActiveActionItems) {
                 const activeNames = Object.keys(results.actionItems);
                if (activeNames.length > 0) {
                    const groupedItems = {};
                    for (const itemName of activeNames) {
                        const itemConfig = actionBarItems[itemName];
                        if (itemConfig && itemConfig.categories) {
                            itemConfig.categories.forEach(category => {
                                if (!groupedItems[category]) groupedItems[category] = [];
                                groupedItems[category].push(itemName);
                            });
                        } else {
                           const category = 'Uncategorized';
                           if (!groupedItems[category]) groupedItems[category] = [];
                           groupedItems[category].push(itemName);
                        }
                    }

                    const categories = Object.keys(groupedItems);
                    const maxItems = categories.length > 0 ? Math.max(...Object.values(groupedItems).map(arr => arr.length)) : 0;
                    const tableData = [];

                    for (let i = 0; i < maxItems; i++) {
                        const row = {};
                        for (const category of categories) {
                            const itemKey = groupedItems[category][i];
                            const displayName = (itemKey && actionBarItems[itemKey] && actionBarItems[itemKey].name) ? actionBarItems[itemKey].name : (itemKey || '');
                            row[category] = displayName;
                        }
                        tableData.push(row);
                    }

                    console.log("[Monitor] Active Action Items by Category:");
                    if (tableData.length > 0) {
                        console.table(tableData, categories);
                    } else {
                        console.log("(None detected this cycle)");
                    }
                } else if (previousActionItemCount > 0) {
                     console.log("[Monitor] Active Action Items by Category: (None detected this cycle)");
                }
             }
         } catch(e) {
            console.error("Error finding action items:", e);
            results.actionItems = {};
        }
    }

    if (amuletSlotRegion && validateRegionDimensions(amuletSlotRegion)) {
        try {
            const foundItems = findSequencesNative(frameDataBuffer, equippedItems, amuletSlotRegion, "first");
            const detectedItemName = Object.keys(foundItems).find(key => foundItems[key] !== null);
            results.equipped.amulet = detectedItemName || null;
            detectedAmulet = results.equipped.amulet;
        } catch (e) { console.error("Error scanning amulet slot:", e); results.equipped.amulet = null; detectedAmulet = null; }
    } else {
        results.equipped.amulet = null; detectedAmulet = null;
    }

    if (ringSlotRegion && validateRegionDimensions(ringSlotRegion)) {
         try {
             const foundItems = findSequencesNative(frameDataBuffer, equippedItems, ringSlotRegion, "first");
             const detectedItemName = Object.keys(foundItems).find(key => foundItems[key] !== null);
             results.equipped.ring = detectedItemName || null;
             detectedRing = results.equipped.ring;
         } catch (e) { console.error("Error scanning ring slot:", e); results.equipped.ring = null; detectedRing = null;}
    } else {
        results.equipped.ring = null; detectedRing = null;
    }

    if (config.logging.logEquippedItems) {
        console.log(`[Monitor] Equipment -> Amulet: ${detectedAmulet || 'None'}, Ring: ${detectedRing || 'None'}`);
    }

    return results;
}


function processCapturedData(fullFrameData, dynamicRegionResults) {
  if (config.captureRegions.hpMana.enabled && !fullFrameData) {
      console.warn('HP/Mana region enabled but frame capture failed. Triggering re-initialization.');
      shouldRestart = true;
      return null;
  }

  if (config.processing.trackMinimap && minimapRegion && fullFrameData?.data) {
       handleMinimapChange(fullFrameData.data, minimapRegion);
  }

  return dynamicRegionResults;
}


function calculateHealthAndMana(fullFrameData) {
  if (!hpbar || !mpbar || !hpManaRegion || !fullFrameData?.data || !dimensions) {
      return { newHealthPercentage: -1, newManaPercentage: -1 };
  }
  const health = calculatePercentages(fullFrameData.data, dimensions.width, hpManaRegion, hpbar, resourceBars.healthBar);
  const mana = calculatePercentages(fullFrameData.data, dimensions.width, hpManaRegion, mpbar, resourceBars.manaBar);
  return { newHealthPercentage: health, newManaPercentage: mana };
}


function getCharacterStatus(dynamicResults) {
  const status = {};
  const currentStatusBarRegions = dynamicResults?.statusBar || {};
  Object.keys(statusBarSequences).forEach(key => {
      status[key] = currentStatusBarRegions[key]?.x !== undefined;
  });
  return status;
}


function getBattleListEntries(frameDataBuffer) {
  if (!battleListRegion || !frameDataBuffer) return [];
  if (typeof findSequencesNative !== 'function') {
       console.error("getBattleListEntries: findSequencesNative is not loaded!");
       return [];
  }
  try {
      const entries = findAllOccurrences(findSequencesNative, frameDataBuffer, battleListSequences.battleEntry, battleListRegion);
      return entries;
  } catch(e) {
      console.error("Error finding battle list entries:", e);
      return [];
  }
}


function calculatePartyHp(frameDataBuffer, barRegionInPartyList) {
    if (!frameDataBuffer || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(barRegionInPartyList)) return -1;
    try {
        const absoluteBarStartX = barRegionInPartyList.x;
        const absoluteBarStartY = barRegionInPartyList.y;
        if (!dimensions) { console.warn("Cannot calculate party HP, dimensions unknown."); return -1; }
        const fullBufferWidth = dimensions.width;
        const bytesPerPixel = 3;
        const headerSize = 8;
        const barStartIndexBytesInData = (absoluteBarStartY * fullBufferWidth + absoluteBarStartX) * bytesPerPixel;
        const absoluteByteOffset = barStartIndexBytesInData + headerSize;

        if (absoluteByteOffset < headerSize || absoluteByteOffset >= frameDataBuffer.length) {
             console.warn(`Calculated party HP bar start index (${absoluteByteOffset}) out of bounds.`);
             return -1;
        }
        return calculatePartyHpPercentage(frameDataBuffer, resourceBars.partyEntryHpBar, absoluteByteOffset, barRegionInPartyList.width);
    } catch (error) {
        console.error('Error calculating party HP:', error);
        return -1;
    }
}


function checkPartyMemberStatus(frameDataBuffer, nameRegionInPartyList) {
  if (!frameDataBuffer || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(nameRegionInPartyList)) return false;
  try {
    const statusResult = findSequencesNative(frameDataBuffer, PARTY_MEMBER_STATUS, nameRegionInPartyList, "first");
    return statusResult && Object.values(statusResult).some(coords => coords !== null);
  } catch (error) {
    console.error('Error checking party member status:', error);
    return false;
  }
}


function getPartyData(frameDataBuffer) {
  if (!config.processing.handleParty || !validateRegionDimensions(partyListRegion) || !frameDataBuffer) return [];

  const partyData = [];
  const approxEntryHeight = 26;
  const maxEntries = partyListRegion ? Math.floor(partyListRegion.height / approxEntryHeight) : 0;
  if (maxEntries <= 0) return [];

  const partyEntryRegions = calculatePartyEntryRegions(partyListRegion, maxEntries);

  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    if (validateRegionDimensions(entry.bar) && validateRegionDimensions(entry.name)) {
      const hpPercentage = calculatePartyHp(frameDataBuffer, entry.bar);
      const isActive = checkPartyMemberStatus(frameDataBuffer, entry.name);
      if (hpPercentage >= 0) {
          partyData.push({ id: i, hpPercentage, uhCoordinates: entry.uhCoordinates, isActive });
      }
    }
  }
  return partyData;
}


function runRules(fullFrameData, dynamicRegionResults) {
  if (!fullFrameData || !dynamicRegionResults) return;
  const frameDataBuffer = fullFrameData.data;

  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(fullFrameData);
  const characterStatus = getCharacterStatus(dynamicRegionResults);
  const currentCooldownRegions = dynamicRegionResults.cooldowns || {};
  const activeActionItems = dynamicRegionResults.actionItems || {};
  const equippedItemsResult = dynamicRegionResults.equipped || {};
  const battleListEntries = getBattleListEntries(frameDataBuffer);
  const partyMembers = getPartyData(frameDataBuffer);

  if (currentCooldownRegions.attackInactive?.x !== undefined) cooldownManager.forceDeactivate('attack');
  if (currentCooldownRegions.healingInactive?.x !== undefined) cooldownManager.forceDeactivate('healing');
  if (currentCooldownRegions.supportInactive?.x !== undefined) cooldownManager.forceDeactivate('support');
  const healingCdActive = cooldownManager.updateCooldown('healing', currentCooldownRegions.healing?.x !== undefined);
  const supportCdActive = cooldownManager.updateCooldown('support', currentCooldownRegions.support?.x !== undefined);
  const attackCdActive = cooldownManager.updateCooldown('attack', currentCooldownRegions.attack?.x !== undefined);

  const ruleInput = {
    hpPercentage: newHealthPercentage, manaPercentage: newManaPercentage,
    healingCdActive, supportCdActive, attackCdActive,
    characterStatus,
    monsterNum: battleListEntries.length,
    isWalking: minimapChanged,
    partyMembers,
    activeActionItems,
    equippedItems: {
        amulet: equippedItemsResult.amulet,
        ring: equippedItemsResult.ring,
    },
  };

  const currentPreset = state?.healing?.presets?.[state?.healing?.activePresetIndex];
  if (!currentPreset) {
      if (config.logging.logRuleProcessing) console.warn("No active healing preset found for rule processing.");
      return;
  }

  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Error during rule processing:', error);
  }
}


function handleHealthAndManaUpdates(fullFrameData) {
  if(!fullFrameData) return;
  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(fullFrameData);

  if (newHealthPercentage >= 0 && newHealthPercentage !== lastDispatchedHealthPercentage) {
      dispatchHealthUpdate(newHealthPercentage);
      lastDispatchedHealthPercentage = newHealthPercentage;
  }
  if (newManaPercentage >= 0 && newManaPercentage !== lastDispatchedManaPercentage) {
      dispatchManaUpdate(newManaPercentage);
      lastDispatchedManaPercentage = newManaPercentage;
  }
}


async function mainLoopIteration() {
  if (config.logging.clearTerminal) {
    console.log('\x1Bc');
  }

  const logPerf = config.logging.logPerformanceMetrics;
  const logCapture = config.logging.logCaptureStatus;
  const loopStart = logPerf ? performance.now() : 0;
  let initMs = 0, frameGetMs = 0, dimCheckMs = 0, dynamicRegionsMs = 0;
  let staticProcessMs = 0, rulesMs = 0, hpManaMs = 0, totalMs = 0;

  try {
    if (needsInitialization()) {
      const initStart = logPerf ? performance.now() : 0;
      await initializeRegions();
      if (logPerf) initMs = performance.now() - initStart;
      if (!initialized) { await delay(1000); return; }
      successfulFramesThisSecond = 0;
      lastFpsLogTime = Date.now();
      lastSuccessfulFrameTime = 0;
    }

    if (initialized) {
      const frameGetStart = logPerf ? performance.now() : 0;
      if (logCapture) console.log('[ScreenMonitor] Attempting captureInstance.getLatestFrame()');
      const frame = captureInstance.getLatestFrame();
      if (logPerf) frameGetMs = performance.now() - frameGetStart;

      let isUsingStaleData = false;
      if (!frame || !frame.data) {
          consecutiveFrameFailures++;
          isUsingStaleData = true;
          if (logCapture) console.warn(`[ScreenMonitor] getLatestFrame FAILED. Consecutive failures: ${consecutiveFrameFailures}. Will use stale data if available.`);
      } else {
          if (logCapture) console.log(`[ScreenMonitor] getLatestFrame SUCCESS. Frame: ${frame.width}x${frame.height}, Length: ${frame.data?.length}`);
          if (consecutiveFrameFailures > 0) {
              if (logCapture) console.log(`[ScreenMonitor] Resetting consecutiveFrameFailures from ${consecutiveFrameFailures} to 0.`);
              consecutiveFrameFailures = 0;
          }
          currentFrameData = frame;
          isUsingStaleData = false;
          lastSuccessfulFrameTime = Date.now();
      }

      if (!currentFrameData) {
          console.error("[ScreenMonitor] CRITICAL: No valid frame data (currentFrameData is null). Skipping cycle.");
          return;
      }
      if (isUsingStaleData && logCapture) console.warn(`[ScreenMonitor] Using stale frame data from previous cycle.`);

      if (!isUsingStaleData) successfulFramesThisSecond++;
      const now = Date.now();
      if (now - lastFpsLogTime >= 1000) {
          if (successfulFramesThisSecond !== lastDispatchedFps) {
              dispatchFpsUpdate(successfulFramesThisSecond);
              lastDispatchedFps = successfulFramesThisSecond;
          }
          if (config.logging.logPerformanceMetrics) console.log(`Perf: Captured FPS: ${successfulFramesThisSecond}`);
          successfulFramesThisSecond = 0;
          lastFpsLogTime = now;
      }

      const dimCheckStart = logPerf ? performance.now() : 0;
      let dimensionsStable = true;
      if (!lastDimensions || currentFrameData.width !== lastDimensions.width || currentFrameData.height !== lastDimensions.height) {
          console.warn(`Frame dimensions ${currentFrameData.width}x${currentFrameData.height} differ from last known ${lastDimensions?.width}x${lastDimensions?.height}. Triggering resize.`);
          handleResizeStart({ width: currentFrameData.width, height: currentFrameData.height });
          dimensionsStable = false;
          if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
      }
      if (dimensionsStable) {
          dimensions = { width: currentFrameData.width, height: currentFrameData.height };
      }
      if (logPerf) dimCheckMs = performance.now() - dimCheckStart;

      if (!dimensionsStable) {
          consecutiveFrameFailures = 0; successfulFramesThisSecond = 0; lastFpsLogTime = Date.now();
          return;
      }

      const STALE_DATA_THRESHOLD_MS = config.staleDataThreshold || 100;
      const timeSinceLastSuccess = lastSuccessfulFrameTime > 0 ? Date.now() - lastSuccessfulFrameTime : Infinity;
      const canProcessData = !isUsingStaleData || timeSinceLastSuccess <= STALE_DATA_THRESHOLD_MS;

      if (canProcessData) {
        const dynamicRegionsStart = logPerf ? performance.now() : 0;
        const dynamicRegionResults = processDynamicRegions(currentFrameData.data);
        if (logPerf) dynamicRegionsMs = performance.now() - dynamicRegionsStart;

        const staticProcessStart = logPerf ? performance.now() : 0;
        const processedStatus = processCapturedData(currentFrameData, dynamicRegionResults);
        if (logPerf) staticProcessMs = performance.now() - staticProcessStart;

        if (processedStatus === null || shouldRestart) {
             console.log("Processing triggered restart.");
             if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
             consecutiveFrameFailures = 0; successfulFramesThisSecond = 0; lastFpsLogTime = Date.now(); lastSuccessfulFrameTime = 0;
             return;
        }

        if (state?.global?.botEnabled) {
            const rulesStart = logPerf ? performance.now() : 0;
            try {
                runRules(currentFrameData, processedStatus);
            } catch (ruleError) {
                console.error('[ScreenMonitor] CRITICAL ERROR during rule processing:', ruleError);
                shouldRestart = true; initialized = false; consecutiveFrameFailures = 0;
                successfulFramesThisSecond = 0; lastFpsLogTime = Date.now(); lastSuccessfulFrameTime = 0;
                if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
                return;
            }
            if (logPerf) rulesMs = performance.now() - rulesStart;
        }

        const hpManaStart = logPerf ? performance.now() : 0;
        handleHealthAndManaUpdates(currentFrameData);
        if (logPerf) hpManaMs = performance.now() - hpManaStart;

      } else {
          if (logCapture) console.warn(`[ScreenMonitor] Skipping processing cycle. No new frame and last successful frame was ${timeSinceLastSuccess.toFixed(0)}ms ago (>${STALE_DATA_THRESHOLD_MS}ms threshold).`);
      }
    }
  } catch (err) {
    console.error('[ScreenMonitor] Error in main loop iteration:', err);
    shouldRestart = true; initialized = false; consecutiveFrameFailures = 0;
    if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
    successfulFramesThisSecond = 0; lastFpsLogTime = Date.now(); lastSuccessfulFrameTime = 0;
  } finally {
    if (logPerf) {
       const loopEnd = performance.now(); totalMs = loopEnd - loopStart;
       const format = (ms) => ms.toFixed(1);
       console.log(
         `Perf: Total=${format(totalMs)}ms ` +
         `[Init=${format(initMs)} Frame=${format(frameGetMs)} DimChk=${format(dimCheckMs)} ` +
         `DynRg=${format(dynamicRegionsMs)} StatRg=${format(staticProcessMs)} ` +
         `Rules=${format(rulesMs)} HpMana=${format(hpManaMs)}]`
       );
    }
  }
}

async function start() {
  if (isMainThread) {
    console.error("[ScreenMonitor] This script must be run as a worker thread.");
    process.exit(1);
  }
  if (!captureInstance || !findSequencesNative) {
    console.error("[ScreenMonitor] Essential native dependencies failed to load.");
    if (parentPort) parentPort.postMessage({ fatalError: 'Missing native dependencies' });
    process.exit(1);
  }

  console.log('[ScreenMonitor] Worker started successfully.');
  lastFpsLogTime = Date.now();

  while (true) {
    const loopStart = performance.now();
    await mainLoopIteration();
    const executionTime = performance.now() - loopStart;
    const delayTime = calculateDelayTime(executionTime, state?.global?.refreshRate);
    if (delayTime > 0) {
        await delay(delayTime);
    }
  }
}

parentPort.on('message', (message) => {
  if (message && message.command === 'forceReinitialize') {
      console.log('[ScreenMonitor] Received forceReinitialize command. Triggering re-initialization.');
      if (captureInstance && initialized) {
          try {
              captureInstance.stopContinuousCapture();
              console.log('[ScreenMonitor] Stopped capture due to forceReinitialize.');
          } catch (e) { console.error('[ScreenMonitor] Error stopping capture on forceReinitialize:', e); }
      }
      initialized = false; shouldRestart = true; currentRefreshRate = null;
      resetRegions();
      return;
  }

  const previousWindowId = state?.global?.windowId;
  const previousRefreshRate = currentRefreshRate;
  state = message;
  const newWindowId = state?.global?.windowId;
  const newRefreshRateRaw = state?.global?.refreshRate;

  if (newWindowId && newWindowId !== previousWindowId) {
    console.log(`[ScreenMonitor] Window ID change detected: ${previousWindowId} -> ${newWindowId}. Re-initializing.`);
    if (captureInstance && initialized) {
      try {
        captureInstance.stopContinuousCapture();
        console.log(`[ScreenMonitor] Stopped capture for old window ID ${previousWindowId}.`);
      } catch (e) { console.error(`[ScreenMonitor] Error stopping capture for old window ID ${previousWindowId}:`, e); }
    }
    initialized = false; shouldRestart = true; currentWindowId = newWindowId; currentRefreshRate = null;
    resetRegions();
    return;
  }

  if (initialized && typeof newRefreshRateRaw === 'number') {
      const newRefreshRateClamped = clampFps(newRefreshRateRaw);
      if (newRefreshRateClamped !== previousRefreshRate) {
          console.log(`[ScreenMonitor] Refresh rate change detected: ${previousRefreshRate} -> ${newRefreshRateClamped}. Updating target FPS.`);
          try {
              captureInstance.setTargetFPS(newRefreshRateClamped);
              currentRefreshRate = newRefreshRateClamped;
          } catch (e) {
              if (e instanceof RangeError) console.error(`[ScreenMonitor] Error setting target FPS to ${newRefreshRateClamped}: ${e.message}.`);
              else console.error(`[ScreenMonitor] Unexpected error setting target FPS:`, e);
          }
      }
  }
});

parentPort.on('close', async () => {
  console.log('[ScreenMonitor] Parent port closed. Stopping capture and shutting down.');
  if (captureInstance) {
      try { captureInstance.stopContinuousCapture(); } catch(e) { console.error("Error stopping capture on close:", e);}
  }
  process.exit(0);
});

start().catch(async (err) => {
  console.error('[ScreenMonitor] Worker encountered fatal error:', err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  if (captureInstance) {
      try { captureInstance.stopContinuousCapture(); } catch(e) { console.error("Error stopping capture on fatal error:", e);}
  }
  process.exit(1);
});