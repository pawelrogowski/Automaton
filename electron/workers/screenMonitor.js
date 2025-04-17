import { parentPort, workerData, isMainThread } from 'worker_threads';
import { createRequire } from 'module';
import { createClient } from 'redis';
import { captureImage } from '../screenMonitor/screenGrabUtils/captureImage.js';
import { findSequences } from '../screenMonitor/screenGrabUtils/findSequences.js';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
} from '../constants/index.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import {
  setHealthPercent,
  setManaPercent,
} from '../../store/store.js';

// --- Dependencies ---
const require = createRequire(import.meta.url);
const windowInfoPath = workerData?.windowInfoPath || '';
const x11CapturePath = workerData?.x11capturePath || '';
let windowinfo = null;
let X11Capture = null;
if (windowInfoPath) windowinfo = require(windowInfoPath);
if (x11CapturePath) ({ X11Capture } = require(x11CapturePath));

// --- State Variables ---
let state = null;
let initialized = false;
let shouldRestart = false;
let dimensions = null;
let lastDimensions = null;
let resizeStabilizeTimeout = null;
let fullWindowImageData = null;
let startRegions = null;
let hpManaRegion = null;
let cooldownsRegion = null;
let statusBarRegion = null;
let minimapRegion = null;
let battleListRegion = null;
let partyListRegion = null;
let cooldownBarRegions = null;
let statusBarRegions = null;
let foundActionItems = null;
let actionBarsRegion = null;
let hpbar = null;
let mpbar = null;
let lastMinimapImageData = null;
let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
let lastMinimapChangeTime = null;
let minimapChanged = false;
let lastDimensionCheck = Date.now();
let locatedActionItems = []; // Stores items found during initialization { name, coords, sequence, region }
let activeActionItems = {}; // Stores items verified in the current loop { name: coords }


// --- Constants and Configuration ---
const RESIZE_STABILIZE_DELAY = 250;
const MINIMAP_CHANGE_INTERVAL = 128;
const DIMENSION_CHECK_INTERVAL = 250;

const config = {
  // logLevel: 'silent', // Can keep or remove if using more specific flags
  clearConsole: false, // Example existing setting
  captureRegions: {
    hpMana: { enabled: true },
    cooldowns: { enabled: true },
    statusBar: { enabled: true },
    battleList: { enabled: true },
    partyList: { enabled: true },
    minimap: { enabled: true },
    actionBars: { enabled: true },
  },
  processing: {
    checkDimensions: true,
    trackMinimap: true,
    monitorCooldowns: true,
    handleParty: true,
  },
  // --- NEW Logging Configuration ---
  logging: {
    logActiveActionItems: false, // Set to false by default
    logInitialization: true,     // Example: Keep init logs enabled
    logRegionCaptureFailures: true, // Example
    logDispatchUpdates: false, // <-- ADDED: Control logging for Redis dispatches
    // Add other specific log controls here as needed
  }
  // --- END Logging Configuration ---
};

// --- Instances ---
const captureInstance = X11Capture ? new X11Capture() : null;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

// --- Redis Client State (Worker Specific) ---
let workerRedisClient = null;
let redisIsConnecting = false;
let redisConnectionAttempts = 0;
const MAX_REDIS_CONN_ATTEMPTS = 5;
const REDIS_RETRY_DELAY = 1000; // ms

// --- Helper Functions ---

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelayTime(executionTime) {
  if (!initialized || !state?.global?.refreshRate) {
    return 50;
  }
  return 50;
}

async function dispatchHealthUpdate(percentage) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setHealthPercent',
    payload: { hpPercentage: percentage },
  });

  if (workerRedisClient && workerRedisClient.isReady) {
    try {
      await setHealthPercent(workerRedisClient, percentage);
    } catch (error) {
      if (config.logging.logDispatchUpdates) {
        console.error(`[Dispatch] Failed to update Redis health:`, error);
      }
      if (!redisIsConnecting) connectWorkerRedis();
    }
  } else {
    if (!redisIsConnecting) connectWorkerRedis();
  }
}

async function dispatchManaUpdate(percentage) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setManaPercent',
    payload: { manaPercentage: percentage },
  });

  if (workerRedisClient && workerRedisClient.isReady) {
    try {
      await setManaPercent(workerRedisClient, percentage);
    } catch (error) {
      if (config.logging.logDispatchUpdates) {
        console.error(`[Dispatch] Failed to update Redis mana:`, error);
      }
      if (!redisIsConnecting) connectWorkerRedis();
    }
  } else {
    if (!redisIsConnecting) connectWorkerRedis();
  }
}

function createRegion(bar, width, height) {
  return bar?.x !== undefined ? { x: bar.x, y: bar.y, width, height } : null;
}

function validateRegionDimensions(region) {
  return region?.x !== undefined && region.width > 0 && region.height > 0;
}

function resetRegions() {
  hpManaRegion = null;
  cooldownsRegion = null;
  statusBarRegion = null;
  minimapRegion = null;
  battleListRegion = null;
  partyListRegion = null;
  cooldownBarRegions = null;
  statusBarRegions = null;
  fullWindowImageData = null;
  startRegions = null;
  hpbar = null;
  mpbar = null;
  locatedActionItems = [];
  activeActionItems = {};
}

function findBoundingRegion(startSequence, endSequence, width = 169, height = dimensions.height) {
  if (!fullWindowImageData || !dimensions || !startSequence || !endSequence) {
    console.warn('findBoundingRegion: Missing required data', {
      hasImageData: !!fullWindowImageData,
      hasDimensions: !!dimensions,
      hasStartSequence: !!startSequence,
      hasEndSequence: !!endSequence
    });
    return null;
  }
  try {
    const result = findBoundingRect(fullWindowImageData, startSequence, endSequence, width, height);
    return result.startFound && result.endFound && result.width > 0 && result.height > 0 ? result : null;
  } catch (error) {
    console.error('Error in findBoundingRegion:', error);
    return null;
  }
}

async function initializeRegions() {
  if (!state?.global?.windowId) {
    console.error('Cannot initialize regions: windowId missing.');
    initialized = false;
    shouldRestart = true;
    return;
  }

  // Add a small delay to ensure window is ready
  await new Promise(resolve => setTimeout(resolve, 100));

  resetRegions();
  try {
    // Get and validate window dimensions
    dimensions = windowinfo.getDimensions(state.global.windowId);
    if (!dimensions || !dimensions.width || !dimensions.height) {
      throw new Error('Invalid window dimensions received');
    }
    lastDimensions = dimensions;
    
    // Capture full window image
    fullWindowImageData = await captureImage(
      state.global.windowId,
      { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
      captureInstance,
    );
    
    if (!fullWindowImageData || !Buffer.isBuffer(fullWindowImageData)) {
      throw new Error('Failed to capture window image or invalid image data');
    }

    // Find start regions and validate
    startRegions = findSequences(fullWindowImageData, regionColorSequences, null, 'first', false);
    if (!startRegions || typeof startRegions !== 'object') {
      throw new Error('Failed to find start regions or invalid result');
    }

    // Initialize standard regions
    initializeStandardRegions();
    
    // Validate standard regions before proceeding
    if (!hpManaRegion || !cooldownsRegion || !statusBarRegion || !minimapRegion) {
      console.warn('Some standard regions failed to initialize:', {
        hpMana: !!hpManaRegion,
        cooldowns: !!cooldownsRegion,
        statusBar: !!statusBarRegion,
        minimap: !!minimapRegion
      });
    }

    // Initialize special regions (Action Bar part modified)
    initializeSpecialRegions(fullWindowImageData); // Pass the captured image data
    
    // Validate special regions
    if (config.captureRegions.battleList.enabled && !battleListRegion) {
      console.warn('Battle list region failed to initialize');
    }
    if (config.captureRegions.partyList.enabled && !partyListRegion) {
      console.warn('Party list region failed to initialize');
    }
    if (config.captureRegions.actionBars.enabled && !actionBarsRegion) {
      console.warn('Action bars region failed to initialize');
    }

    // Only mark as initialized if we have at least the essential regions
    initialized = !!hpManaRegion; // We consider HP/Mana region essential
    shouldRestart = !initialized;
    
    if (initialized) {
      notifyInitializationStatus();
    } else {
      throw new Error('Failed to initialize essential regions');
    }
  } catch (error) {
    console.error('Error during region initialization:', error);
    initialized = false;
    shouldRestart = true;
    dimensions = null;
    lastDimensions = null;
    resetRegions();
  }
}

function initializeStandardRegions() {
  if (!startRegions || !dimensions) {
    console.warn('Cannot initialize standard regions: missing startRegions or dimensions');
    return;
  }

  const { healthBar, manaBar, cooldownBar, cooldownBarFallback, statusBar, minimap } = startRegions;
  
  // Validate each bar before creating regions
  if (healthBar?.x !== undefined && manaBar?.x !== undefined) {
    hpbar = healthBar;
    mpbar = manaBar;
    hpManaRegion = createRegion(healthBar, 94, 14);
  } else {
    console.warn('Health or mana bar coordinates missing');
  }

  if (cooldownBar?.x !== undefined || cooldownBarFallback?.x !== undefined) {
    cooldownsRegion = createRegion(cooldownBar || cooldownBarFallback, 56, 4);
  } else {
    console.warn('Cooldown bar coordinates missing');
  }

  if (statusBar?.x !== undefined) {
    statusBarRegion = createRegion(statusBar, 104, 9);
  } else {
    console.warn('Status bar coordinates missing');
  }

  if (minimap?.x !== undefined) {
    minimapRegion = createRegion(minimap, 106, 1);
  } else {
    console.warn('Minimap coordinates missing');
  }
}

// Refined Helper function
function calculateItemRegion(itemConfig, coords) {
    if (!itemConfig || !itemConfig.sequence || !coords) {
        return null;
    }
    const seqLength = itemConfig.sequence.length;
    if (seqLength === 0) return null;

    // Explicitly handle width/height based on direction
    let width = 1;
    let height = 1;
    if (itemConfig.direction === 'horizontal') {
        width = seqLength;
        height = 1; // Assume horizontal sequences are 1 pixel tall
    } else { // vertical
        width = 1; // Assume vertical sequences are 1 pixel wide
        height = seqLength;
    }

    // Ensure width/height are at least 1
    const validWidth = Math.max(1, width);
    const validHeight = Math.max(1, height);

    return { x: coords.x, y: coords.y, width: validWidth, height: validHeight };
}

// Modified function to find and store individual items
function initializeSpecialRegions(initialImageData) {
  if (!initialImageData || !dimensions) {
    console.warn('Cannot initialize special regions: missing image data or dimensions');
    return;
  }

  locatedActionItems = []; // Clear previous locations

  // --- Battle List ---
  if (config.captureRegions.battleList.enabled) {
    const battleRegion = findBoundingRegion(regionColorSequences.battleListStart, regionColorSequences.battleListEnd);
    battleListRegion = validateRegionDimensions(battleRegion) ? battleRegion : null;
  }

  // --- Party List ---
  if (config.captureRegions.partyList.enabled) {
    const partyRegion = findBoundingRegion(regionColorSequences.partyListStart, regionColorSequences.partyListEnd);
    partyListRegion = validateRegionDimensions(partyRegion) ? partyRegion : null;
  }

  // --- Action Bar Items (New Logic) ---
  if (config.captureRegions.actionBars.enabled) {
    const overallActionBarRegion = findBoundingRegion(
      regionColorSequences.hotkeyBarBottomStart,
      regionColorSequences.hotkeyBarBottomEnd,
      dimensions.width,
      dimensions.height,
    );
    const canScanActionBars = validateRegionDimensions(overallActionBarRegion);

    if (canScanActionBars) {
        try {
            console.log('Initializing action bar items scan (Full Image)...');
            const initialFoundItems = findSequences(initialImageData, actionBarItems, null, 'all');

            for (const [name, coordsArray] of Object.entries(initialFoundItems)) {
                 const Rlocations = Array.isArray(coordsArray) ? coordsArray : (coordsArray ? [coordsArray] : []);

                if (Rlocations.length > 0 && actionBarItems[name]) {
                    Rlocations.forEach(coords => {
                         if (coords && coords.x !== undefined &&
                             coords.x >= overallActionBarRegion.x && coords.x < overallActionBarRegion.x + overallActionBarRegion.width &&
                             coords.y >= overallActionBarRegion.y && coords.y < overallActionBarRegion.y + overallActionBarRegion.height)
                         {
                            const itemConfig = actionBarItems[name];
                            const itemRegion = calculateItemRegion(itemConfig, coords);

                            if (validateRegionDimensions(itemRegion)) {
                                locatedActionItems.push({
                                    name: name,
                                    originalCoords: coords,
                                    sequence: itemConfig.sequence,
                                    region: itemRegion,
                                    direction: itemConfig.direction,
                                });
                            }
                         }
                    });
                }
            }
            console.log(`Found and stored ${locatedActionItems.length} action item locations.`);

        } catch (error) {
             console.error("Error during initial action bar item scan:", error);
             locatedActionItems = [];
        }
    } else {
         console.warn("Could not determine overall action bar region. Skipping action bar initialization.");
    }
  }
}

function notifyInitializationStatus() {
  const status = {
    hpManaRegion: !!hpManaRegion,
    cooldownsRegion: !!cooldownsRegion,
    statusBarRegion: !!statusBarRegion,
    minimapRegion: !!minimapRegion,
    battleListRegion: !!battleListRegion,
    partyListRegion: !!partyListRegion,
    actionBars: locatedActionItems.length > 0,
  };
  let message = 'Region Init Status:\n';
  for (const [region, found] of Object.entries(status)) {
    const regionName = region === 'actionBars' ? 'Action Bar Items' : region;
    message += `${regionName}: ${found ? '✅' : '❌'} `;
  }
  parentPort.postMessage({ notification: { title: 'Monitor Status', body: message.trim() } });
}

function handleResizeStart(newDimensions) {
  dimensions = newDimensions;
  lastDimensions = newDimensions;
  if (resizeStabilizeTimeout) clearTimeout(resizeStabilizeTimeout);
  parentPort.postMessage({ notification: { title: 'Monitor Warning', body: 'Window Size Changed - Re-initializing...' } });
  initialized = false;
  shouldRestart = true;
  resizeStabilizeTimeout = setTimeout(() => {
    resizeStabilizeTimeout = null;
  }, RESIZE_STABILIZE_DELAY);
}

function validateDimensions() {
  if (!state?.global?.windowId) return false;
  try {
    const currentDimensions = windowinfo.getDimensions(state.global.windowId);
    const isValid = dimensions && currentDimensions.width === dimensions.width && currentDimensions.height === dimensions.height;

    if (!isValid && dimensions) {
      handleResizeStart(currentDimensions);
      return false;
    } else if (!dimensions && !shouldRestart) {
      shouldRestart = true;
      return false;
    }
    return isValid;
  } catch (error) {
    console.error('Error validating dimensions:', error);
    if (!shouldRestart) handleResizeStart(null);
    return false;
  }
}

function checkDimensionsRegularly() {
  if (!config.processing.checkDimensions) return;
  if (Date.now() - lastDimensionCheck > DIMENSION_CHECK_INTERVAL) {
    lastDimensionCheck = Date.now();
    validateDimensions();
  }
}

function needsInitialization() {
  return (!initialized && state?.global?.windowId && state?.global?.refreshRate) || shouldRestart;
}

function addPartyRegions(regionsToGrab, regionTypes) {
  if (validateRegionDimensions(partyListRegion)) {
    const approxEntryHeight = 26;
    const maxEntries = Math.floor(partyListRegion.height / approxEntryHeight);
    const partyEntryRegions = calculatePartyEntryRegions(partyListRegion, maxEntries);
    partyEntryRegions.forEach((entry, index) => {
      if (validateRegionDimensions(entry.bar)) {
        regionsToGrab.push(entry.bar);
        regionTypes.push(`partyEntryBar_${index}`);
      }
      if (validateRegionDimensions(entry.name)) {
        regionsToGrab.push(entry.name);
        regionTypes.push(`partyEntryName_${index}`);
      }
    });
  }
}

function prepareRegionsForCapture() {
  const regionsToGrab = [];
  const regionTypes = [];
  const potentialRegions = [
    { type: 'hpMana', region: hpManaRegion },
    { type: 'cooldowns', region: cooldownsRegion },
    { type: 'statusBar', region: statusBarRegion },
    { type: 'battleList', region: battleListRegion },
    { type: 'partyList', region: partyListRegion },
    { type: 'minimap', region: minimapRegion },
  ];

  // Add standard regions
  potentialRegions.forEach(({ type, region }) => {
    if (config.captureRegions[type]?.enabled && validateRegionDimensions(region)) {
      regionsToGrab.push(region);
      regionTypes.push(type);
    }
  });

  // Add party regions (if enabled)
  if (config.captureRegions.partyList.enabled) addPartyRegions(regionsToGrab, regionTypes);

  // Add individual action item regions (if enabled)
  if (config.captureRegions.actionBars.enabled) {
    locatedActionItems.forEach((item, index) => {
        const itemType = `actionBar_${item.name}_${index}`;
        regionsToGrab.push(item.region);
        regionTypes.push(itemType);
    });
  }

  return { regionsToGrab, regionTypes };
}

function createCapturedDataMap(grabResults, regionTypes) {
  const capturedData = {};
  grabResults.forEach((result, index) => {
    if (result) capturedData[regionTypes[index]] = result;
    else console.warn(`Capture failed for region type: ${regionTypes[index]}`);
  });
  return capturedData;
}

async function captureAndProcessRegions() {
  if (!state?.global?.windowId || !initialized) return {};
  const { regionsToGrab, regionTypes } = prepareRegionsForCapture();
  if (regionsToGrab.length === 0) return {};
  try {
    const grabResults = await Promise.all(regionsToGrab.map((region) => captureImage(state.global.windowId, region, captureInstance)));
    return createCapturedDataMap(grabResults, regionTypes);
  } catch (error) {
    console.error('Error during region capture:', error);
    shouldRestart = true;
    return {};
  }
}

function handleMinimapChange(minimapData) {
  if (!minimapData) return;
  if (lastMinimapImageData) {
    const minimapIsDifferent = Buffer.compare(minimapData, lastMinimapImageData) !== 0;
    if (minimapIsDifferent) {
      minimapChanged = true;
      lastMinimapChangeTime = Date.now();
    } else if (lastMinimapChangeTime && Date.now() - lastMinimapChangeTime > MINIMAP_CHANGE_INTERVAL) {
      minimapChanged = false;
      lastMinimapChangeTime = null;
    }
  } else {
    minimapChanged = false;
  }
  lastMinimapImageData = minimapData;
}

function updateCooldowns(cooldownsData) {
  if (!config.processing.monitorCooldowns) return;
  cooldownBarRegions = cooldownsData
    ? findSequences(cooldownsData, cooldownColorSequences)
    : { healing: { x: undefined }, support: { x: undefined }, attack: { x: undefined } };
}

function processStatusBars(statusBarData) {
  statusBarRegions = statusBarData ? findSequences(statusBarData, statusBarSequences) : {};
}

function verifyItemPresence(capturedBuffer, item, tolerance = 5) {
    if (!capturedBuffer || !item || !item.sequence || capturedBuffer.length < 8) {
        return false;
    }

    const bufferWidth = capturedBuffer.readUInt32LE(0);
    const rgbData = new Uint8Array(capturedBuffer.buffer, capturedBuffer.byteOffset + 8);
    const bytesPerPixel = 3;
    const expectedSequenceLength = item.sequence.length;

    if (rgbData.length < bytesPerPixel) {
        return false;
    }

    for (let i = 0; i < expectedSequenceLength; i++) {
        const expectedColor = item.sequence[i];
        if (expectedColor === 'any') continue;

        const [r_expected, g_expected, b_expected] = expectedColor;

        let bufferIndex;
        if (item.direction === 'horizontal') {
            bufferIndex = i * bytesPerPixel;
        } else {
            bufferIndex = i * bufferWidth * bytesPerPixel;
        }

        if (bufferIndex + 2 >= rgbData.length) {
            return false;
        }

        const r_actual = rgbData[bufferIndex];
        const g_actual = rgbData[bufferIndex + 1];
        const b_actual = rgbData[bufferIndex + 2];

        const diffR = Math.abs(r_actual - r_expected);
        const diffG = Math.abs(g_actual - g_expected);
        const diffB = Math.abs(b_actual - b_expected);
        const mismatch = diffR > tolerance || diffG > tolerance || diffB > tolerance;

        if (mismatch) {
            return false;
        }
    }

    return true;
}

function checkLocatedActionItems(capturedData) {
    activeActionItems = {};

    if (!config.captureRegions.actionBars.enabled) return;

    // Optional: Only log check start if verbose logging enabled?
    // if(config.logging.verbose) console.log(`[CheckItems] Checking ${locatedActionItems.length} located items.`);

    locatedActionItems.forEach((item, index) => {
        const itemType = `actionBar_${item.name}_${index}`;
        const itemData = capturedData[itemType];

        if (itemData) {
            if (verifyItemPresence(itemData, item)) { // Using verifyItemPresence with default tolerance
                activeActionItems[item.name] = { x: item.region.x, y: item.region.y };
            }
        }
    });

     // --- Use Config Flag for Logging ---
     if (config.logging.logActiveActionItems) { // Check the flag
         if (Object.keys(activeActionItems).length > 0) {
            console.log('[ScreenMonitor] Active action items:', Object.keys(activeActionItems));
         } else {
            console.log('[ScreenMonitor] No active action items detected this cycle.');
         }
     }
     // --- END Config Flag ---
}

function processCapturedData(capturedData) {
  if (config.captureRegions.hpMana.enabled && !capturedData.hpMana) {
    console.warn('HP/Mana region enabled but capture failed. Triggering re-initialization.');
    shouldRestart = true;
    return;
  }
  if (config.processing.trackMinimap && capturedData.minimap) handleMinimapChange(capturedData.minimap);
  if (config.captureRegions.cooldowns.enabled) updateCooldowns(capturedData.cooldowns);
  if (config.captureRegions.statusBar.enabled) processStatusBars(capturedData.statusBar);

  checkLocatedActionItems(capturedData);
}

function calculateHealthAndMana(hpManaData) {
  const health = hpbar && hpManaRegion && hpManaData ? calculatePercentages(hpbar, hpManaRegion, hpManaData, resourceBars.healthBar) : -1;
  const mana = mpbar && hpManaRegion && hpManaData ? calculatePercentages(mpbar, hpManaRegion, hpManaData, resourceBars.manaBar) : -1;
  return { newHealthPercentage: health, newManaPercentage: mana };
}

function getCharacterStatus() {
  const status = {};
  const currentRegions = statusBarRegions || {};
  for (const key of Object.keys(statusBarSequences)) status[key] = currentRegions[key]?.x !== undefined;
  return status;
}

function getBattleListEntries(battleListData) {
  return battleListData ? findAllOccurrences(battleListData, battleListSequences.battleEntry) : [];
}

function calculatePartyHp(partyListData, barRegion) {
  if (!partyListData || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(barRegion)) return -1;
  try {
    const barStartXInPartyList = barRegion.x - partyListRegion.x;
    const barStartYInPartyList = barRegion.y - partyListRegion.y;
    const partyListWidth = partyListRegion.width;
    const barStartIndex = (barStartYInPartyList * partyListWidth + barStartXInPartyList) * 3;
    if (barStartIndex < 0 || barStartIndex >= partyListData.length) {
      console.warn(`Calculated party HP bar start index (${barStartIndex}) out of bounds.`);
      return -1;
    }
    return calculatePartyHpPercentage(partyListData, resourceBars.partyEntryHpBar, barStartIndex, barRegion.width);
  } catch (error) {
    console.error('Error calculating party HP:', error);
    return -1;
  }
}

function checkPartyMemberStatus(partyListData, nameRegion) {
  if (!partyListData || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(nameRegion)) return false;
  try {
    // Simplified check - assumes findSequences can work on sub-buffers or is context-aware.
    // NOTE: Multi-line name checks might be inaccurate without proper sub-buffer extraction.
    if (nameRegion.height === 1) {
      const nameStartXInPartyList = nameRegion.x - partyListRegion.x;
      const nameStartYInPartyList = nameRegion.y - partyListRegion.y;
      const partyListWidth = partyListRegion.width;
      const nameWidth = nameRegion.width;
      const bytesPerPixel = 3;
      const nameStartIndexBytes = (nameStartYInPartyList * partyListWidth + nameStartXInPartyList) * bytesPerPixel;
      const nameEndIndexBytes = nameStartIndexBytes + nameWidth * bytesPerPixel;
      if (nameStartIndexBytes < 0 || nameEndIndexBytes > partyListData.length) {
        console.warn('Calculated party name indices out of bounds.');
        return false;
      }
      const nameBuffer = partyListData.subarray(nameStartIndexBytes, nameEndIndexBytes);
      const statusResult = findSequences(nameBuffer, PARTY_MEMBER_STATUS, null, 'first', true);
      return (
        (statusResult.active && Object.keys(statusResult.active).length > 0) ||
        (statusResult.activeHover && Object.keys(statusResult.activeHover).length > 0)
      );
    } else {
      console.warn('Multi-line party name status check may be inaccurate.');
      // Fallback: check whole buffer (less precise)
      const statusResult = findSequences(partyListData, PARTY_MEMBER_STATUS, null, 'first', true);
      return (
        (statusResult.active && Object.keys(statusResult.active).length > 0) ||
        (statusResult.activeHover && Object.keys(statusResult.activeHover).length > 0)
      );
    }
  } catch (error) {
    console.error('Error checking party member status:', error);
    return false;
  }
}

function getPartyData(partyListData) {
  if (!config.processing.handleParty || !validateRegionDimensions(partyListRegion) || !partyListData) return [];
  const partyData = [];
  const approxEntryHeight = 26;
  const maxEntries = Math.floor(partyListRegion.height / approxEntryHeight);
  const partyEntryRegions = calculatePartyEntryRegions(partyListRegion, maxEntries);
  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    if (validateRegionDimensions(entry.bar) && validateRegionDimensions(entry.name)) {
      const hpPercentage = calculatePartyHp(partyListData, entry.bar);
      const isActive = checkPartyMemberStatus(partyListData, entry.name);
      if (hpPercentage >= 0) {
        partyData.push({ id: i, hpPercentage, uhCoordinates: entry.uhCoordinates, isActive });
      }
    }
  }
  return partyData;
}

function runRules(capturedData) {
  const hpManaData = capturedData.hpMana || null;
  const battleListData = capturedData.battleList || null;
  const partyListData =
    config.captureRegions.partyList.enabled && validateRegionDimensions(partyListRegion) && capturedData.partyList
      ? capturedData.partyList
      : null;

  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(hpManaData);
  const characterStatus = getCharacterStatus();
  const battleListEntries = getBattleListEntries(battleListData);
  const partyMembers = getPartyData(partyListData);
  const currentCooldownRegions = cooldownBarRegions || { healing: { x: undefined }, support: { x: undefined }, attack: { x: undefined } };

  if (currentCooldownRegions.attackInactive?.x !== undefined) cooldownManager.forceDeactivate('attack');
  if (currentCooldownRegions.healingInactive?.x !== undefined) cooldownManager.forceDeactivate('healing');
  if (currentCooldownRegions.supportInactive?.x !== undefined) cooldownManager.forceDeactivate('support');

  const healingCdActive = cooldownManager.updateCooldown('healing', currentCooldownRegions.healing?.x !== undefined);
  const supportCdActive = cooldownManager.updateCooldown('support', currentCooldownRegions.support?.x !== undefined);
  const attackCdActive = cooldownManager.updateCooldown('attack', currentCooldownRegions.attack?.x !== undefined);

  const ruleInput = {
    hpPercentage: newHealthPercentage,
    manaPercentage: newManaPercentage,
    healingCdActive,
    supportCdActive,
    attackCdActive,
    characterStatus,
    monsterNum: battleListEntries.length,
    isWalking: minimapChanged,
    partyMembers,
  };

  const currentPreset = state?.healing?.presets?.[state?.healing?.activePresetIndex];
  if (!currentPreset) return;

  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Error during rule processing:', error);
  }
}

function handleHealthAndManaUpdates(capturedData) {
  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(capturedData.hpMana);
  if (newHealthPercentage >= 0 && newHealthPercentage !== lastDispatchedHealthPercentage) {
    dispatchHealthUpdate(newHealthPercentage);
    lastDispatchedHealthPercentage = newHealthPercentage;
  }
  if (newManaPercentage >= 0 && newManaPercentage !== lastDispatchedManaPercentage) {
    dispatchManaUpdate(newManaPercentage);
    lastDispatchedManaPercentage = newManaPercentage;
  }
}

// --- Main Loop ---
async function mainLoopIteration() {
  try {
    if (!workerRedisClient || !workerRedisClient.isReady) {
      if (!redisIsConnecting) await connectWorkerRedis();
      if (!workerRedisClient || !workerRedisClient.isReady) {
        await delay(500);
        return;
      }
    }

    if (needsInitialization()) {
      await initializeRegions();
      if (!initialized) return;
    }

    if (initialized) {
      checkDimensionsRegularly();
      if (shouldRestart) return;
      if (!validateDimensions()) return;

      const capturedData = await captureAndProcessRegions();
      processCapturedData(capturedData);
      if (shouldRestart) return;

      if (state?.global?.botEnabled) runRules(capturedData);
      handleHealthAndManaUpdates(capturedData);
    }
  } catch (err) {
    console.error('[ScreenMonitor] Error in main loop iteration:', err);
    shouldRestart = true;
    initialized = false;
  }
}

async function start() {
  if (isMainThread) {
    console.error("[ScreenMonitor] This script should be run as a worker thread.");
    process.exit(1);
  }
  if (!windowinfo || !captureInstance) {
    console.error("[ScreenMonitor] Missing required X11 native dependencies. Ensure paths are correct.");
    parentPort.postMessage({ error: 'Missing native dependencies' });
    process.exit(1);
  }

  console.log('[ScreenMonitor] Worker started.');
  await connectWorkerRedis();

  while (true) {
    const iterationStart = Date.now();
    await mainLoopIteration();
    const executionTime = Date.now() - iterationStart;
    const delayTime = calculateDelayTime(executionTime);
    if (delayTime > 0) await delay(delayTime);
  }
}

// --- Event Listener for Redux State ---
parentPort.on('message', (updatedReduxState) => {
  state = updatedReduxState;
});

parentPort.on('close', async () => {
  console.log('[ScreenMonitor] Parent port closed. Worker shutting down.');
  await disconnectWorkerRedis();
  process.exit(0);
});

// --- Start the Worker ---
start().catch((err) => {
  console.error('[ScreenMonitor] Worker fatal error:', err);
  if (parentPort) {
    parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error' });
  }
  process.exit(1);
});

// --- Connect Worker Redis Client ---
async function connectWorkerRedis() {
  if (workerRedisClient && workerRedisClient.isReady) {
    return true;
  }
  if (redisIsConnecting || !workerData?.redisHost || !workerData?.redisPort) {
    return false;
  }

  redisIsConnecting = true;
  redisConnectionAttempts++;
  console.log(`[ScreenMonitor] Attempting Redis connection to ${workerData.redisHost}:${workerData.redisPort} (Attempt ${redisConnectionAttempts})...`);

  try {
    workerRedisClient = createClient({
      socket: {
        host: workerData.redisHost,
        port: workerData.redisPort,
        connectTimeout: 2000,
      },
    });

    workerRedisClient.on('error', (err) => {
      console.error('[ScreenMonitor] Worker Redis Client Error:', err.message);
      if (workerRedisClient && !workerRedisClient.isReady) {
        redisIsConnecting = false;
        workerRedisClient = null;
      }
    });
    workerRedisClient.on('ready', () => {
      console.log('[ScreenMonitor] Worker Redis Client Ready.');
      redisConnectionAttempts = 0;
      redisIsConnecting = false;
    });
    workerRedisClient.on('end', () => {
      console.log('[ScreenMonitor] Worker Redis Client Connection Ended.');
      workerRedisClient = null;
      redisIsConnecting = false;
    });

    await workerRedisClient.connect();
    redisIsConnecting = false;
    return true;
  } catch (err) {
    console.error(`[ScreenMonitor] Failed Redis connection attempt ${redisConnectionAttempts}:`, err.message);
    workerRedisClient = null;
    redisIsConnecting = false;
    if (redisConnectionAttempts < MAX_REDIS_CONN_ATTEMPTS) {
      setTimeout(connectWorkerRedis, REDIS_RETRY_DELAY * redisConnectionAttempts);
    } else {
      console.error(`[ScreenMonitor] Max Redis connection attempts reached. Giving up.`);
    }
    return false;
  }
}

// --- Disconnect Worker Redis Client (Optional - Called on Exit?) ---
async function disconnectWorkerRedis() {
  if (workerRedisClient && workerRedisClient.isOpen) {
    try {
      await workerRedisClient.quit();
      console.log('[ScreenMonitor] Worker Redis client disconnected.');
    } catch (err) {
      console.error('[ScreenMonitor] Error disconnecting worker Redis client:', err);
    } finally {
      workerRedisClient = null;
    }
  }
}
