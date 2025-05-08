// screenMonitor.js
import { parentPort, workerData, isMainThread } from 'worker_threads';
import { createRequire } from 'module';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
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
    // Notify parent and exit if essential module fails
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load X11Capture module' });
    process.exit(1); // Exit worker if capture cannot work
}
try {
    if (findSequencesPath) ({ findSequencesNative } = require(findSequencesPath));
    else throw new Error('findSequencesPath not provided in workerData');
} catch(e) {
    console.error("FATAL: Failed to load findSequencesNative module:", e);
    if (parentPort) parentPort.postMessage({ fatalError: 'Failed to load findSequencesNative module' });
    process.exit(1); // Exit worker if sequence finding cannot work
}


// --- State Variables ---
let state = null; // Holds the latest Redux state received from parent
let initialized = false; // Has the worker successfully initialized regions?
let shouldRestart = false; // Flag to signal the main loop should re-initialize
let dimensions = null; // Current dimensions derived from the latest valid frame { width, height }
let lastDimensions = null; // Dimensions recorded after last successful init or resize handling

let currentFrameData = null; // Stores the latest full frame object { width, height, data: Buffer }
let startRegions = null; // Results from findSequencesNative for layout markers during init
// Specific region definitions (store {x, y, width, height} relative to full window)
let hpManaRegion = null;
let cooldownsRegion = null;
let statusBarRegion = null;
let minimapRegion = null;
let battleListRegion = null;
let partyListRegion = null;
let overallActionBarsRegion = null; // Bounding box for all action bars
let amuletSlotRegion = null; // <-- Add region for amulet slot
let ringSlotRegion = null;   // <-- Add region for ring slot

let locatedActionItems = []; // Array of { name, originalCoords, sequence, region, direction }
let detectedAmulet = null; // <-- State for detected amulet item name
let detectedRing = null;   // <-- State for detected ring item name
// HP/MP bar coordinates relative to hpManaRegion's top-left
let hpbar = null; // { x, y }
let mpbar = null; // { x, y }
// Minimap change detection state
let lastMinimapData = null;
let lastMinimapChangeTime = null;
let minimapChanged = false;

let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
let previousActionItemCount = -1; // Add state for previous action item count
let consecutiveFrameFailures = 0; // Counter for failed frame gets
const MAX_CONSECUTIVE_FRAME_FAILURES = 10; // Threshold to trigger restart

let currentWindowId = null;
let currentRefreshRate = null; // Add variable to track the current refresh rate
let successfulFramesThisSecond = 0; // Counter for FPS calculation
let lastFpsLogTime = Date.now(); // Time of the last FPS log
let lastDispatchedFps = 0; // Track the last FPS value dispatched
let lastSuccessfulFrameTime = 0; // Timestamp of the last successful frame capture


// --- Instances ---
const captureInstance = X11Capture ? new X11Capture() : null;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

// --- Helper Functions ---


// Dispatch HP update to the main process
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

// Dispatch actual FPS update to the main process
async function dispatchFpsUpdate(fps) {
  parentPort.postMessage({
    storeUpdate: true,
    type: 'setActualFps', // New type for FPS updates
    payload: { actualFps: fps },
  });
}


function resetRegions() {
  hpManaRegion = null; cooldownsRegion = null; statusBarRegion = null; minimapRegion = null;
  battleListRegion = null; partyListRegion = null; overallActionBarsRegion = null;
  amuletSlotRegion = null; // <-- Reset amulet region
  ringSlotRegion = null;   // <-- Reset ring region
  currentFrameData = null; startRegions = null; hpbar = null; mpbar = null;
  lastMinimapData = null; locatedActionItems = [];
  detectedAmulet = null; // <-- Reset detected amulet
  detectedRing = null;   // <-- Reset detected ring
  // Reset dimension tracking
  dimensions = null;
  lastDimensions = null;
  // Reset dispatch tracking
  lastDispatchedHealthPercentage = null;
  lastDispatchedManaPercentage = null;
  previousActionItemCount = -1; // Reset previous action item count
  consecutiveFrameFailures = 0; // Reset frame failure counter
  lastDispatchedFps = 0; // Reset dispatched FPS on region reset
  lastSuccessfulFrameTime = 0; // Reset successful frame timestamp
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


// Clamp FPS value to the valid range [1, 200]
function clampFps(fps) {
    const rate = parseInt(fps, 10);
    if (isNaN(rate)) {
        console.warn(`Invalid refreshRate received: ${fps}. Defaulting to 20.`);
        return 20; // Default FPS if invalid
    }
    return Math.max(10, Math.min(60, rate));
}


async function initializeRegions() {

  if (!state?.global?.windowId) { console.error('Cannot initialize: windowId missing.'); initialized = false; shouldRestart = true; return; }
  if (!captureInstance || !findSequencesNative) { console.error('Cannot initialize: Native module missing.'); initialized = false; shouldRestart = true; return; }
  // Ensure refreshRate exists before proceeding
  if (typeof state?.global?.refreshRate !== 'number') { console.error('Cannot initialize: refreshRate missing or invalid.'); initialized = false; shouldRestart = true; return; }


  if (config.logging.logInitialization) console.log('[Init] Starting region initialization...');
  resetRegions();

  try {
    // --- Start Capture with FPS ---
    try {
      const windowId = state.global.windowId;
      const targetFps = clampFps(state.global.refreshRate); // Clamp FPS
      currentRefreshRate = targetFps; // Store the clamped rate
      if (config.logging.logInitialization) console.log(`[Init] Ensuring continuous capture is started for window ${windowId} at ${targetFps} FPS...`);
      captureInstance.startContinuousCapture(windowId, targetFps); // Pass clamped FPS

      await delay(50);
    } catch (startError) {
       if (startError instanceof RangeError) {
         console.error(`[Init] FATAL: Invalid targetFps provided to startContinuousCapture: ${state.global.refreshRate}. Error: ${startError.message}`);
         // Post fatal error to parent and exit if start fails due to RangeError
         if (parentPort) parentPort.postMessage({ fatalError: `Invalid refreshRate ${state.global.refreshRate}` });
         process.exit(1);
       }
        console.warn(`[Init] Warning during startContinuousCapture: ${startError.message}`);
        // If starting failed for other reasons, still attempt cleanup/restart
        initialized = false; shouldRestart = true; resetRegions();
        return; // Stop initialization here
    }

    
    if (config.logging.logInitialization) console.log('[Init] Attempting to get initial frame for dimensions...');
    let retries = 0; currentFrameData = null;
    while (!currentFrameData && retries < GET_FRAME_MAX_RETRIES) {
        currentFrameData = captureInstance.getLatestFrame();
        if (!currentFrameData) {
            retries++;
            if (config.logging.logInitialization) console.log(`[Init] Initial frame not ready, retry ${retries}/${GET_FRAME_MAX_RETRIES}...`);
            await delay(GET_FRAME_RETRY_DELAY * (retries + 1)); // Exponential backoff
        }
    }
    if (!currentFrameData || !currentFrameData.data) {
        throw new Error(`Failed to get initial window frame after ${GET_FRAME_MAX_RETRIES} retries.`);
    }

    
    dimensions = { width: currentFrameData.width, height: currentFrameData.height };
    lastDimensions = { ...dimensions };
    if (config.logging.logInitialization) console.log(`[Init] Dimensions from first frame: ${dimensions.width}x${dimensions.height}`);

    
    if (config.logging.logInitialization) console.log('[Init] Finding initial layout regions...');
    startRegions = findSequencesNative(currentFrameData.data, regionColorSequences, null, "first"); // Use "first" mode for layout markers
    if (!startRegions || typeof startRegions !== 'object') {
        throw new Error('Failed to find start regions or invalid result from findSequencesNative.');
    }
    if (config.logging.logInitialization) {
        const foundKeys = Object.keys(startRegions).filter(k => startRegions[k]).join(', ');
        // Add equipment slots to the logged keys if found
        const equipmentKeys = ['amuletSlot', 'ringSlot'].filter(k => startRegions[k]).join(', ');
        console.log(`[Init] Layout regions found: ${foundKeys}${equipmentKeys ? ', ' + equipmentKeys : ''}`);
    }

    
    initializeStandardRegions();

    
    initializeSpecialRegions(currentFrameData.data); 

    
    if (!hpManaRegion) { 
      throw new Error('Essential region (HP/Mana) failed to initialize.');
    }
    // Log warnings for non-critical missing regions if logging enabled
    if (config.logging.logRegionCaptureFailures) {
        if (!cooldownsRegion) console.warn('[Init] Cooldowns region failed.');
        if (!statusBarRegion) console.warn('[Init] Status bar region failed.');
        if (!minimapRegion) console.warn('[Init] Minimap region failed.');
        if (config.captureRegions.battleList.enabled && !battleListRegion) console.warn('[Init] Battle list region failed.');
        if (config.captureRegions.partyList.enabled && !partyListRegion) console.warn('[Init] Party list region failed.');
        if (config.captureRegions.actionBars.enabled && !overallActionBarsRegion) console.warn('[Init] Action bars region failed.');
        if (!amuletSlotRegion) console.warn('[Init] Amulet slot region failed.'); // <-- Log amulet failure
        if (!ringSlotRegion) console.warn('[Init] Ring slot region failed.');     // <-- Log ring failure
    }

    
    initialized = true;
    shouldRestart = false;
    if (config.logging.logInitialization) console.log('[Init] Region initialization successful.');
    notifyInitializationStatus(); 
    // Reset FPS counter on init/re-init
    successfulFramesThisSecond = 0;
    lastFpsLogTime = Date.now();
    lastSuccessfulFrameTime = 0; // Ensure reset after potential init

  } catch (error) {
    console.error('[Init] Error during region initialization:', error);
    initialized = false;
    shouldRestart = true;
    dimensions = null; lastDimensions = null;
    currentRefreshRate = null; // Reset refresh rate on error
    resetRegions();

    // Stop capture if it was potentially started before the error
    if (captureInstance && state?.global?.windowId) {
        try { captureInstance.stopContinuousCapture(); } catch (e) { /* Ignore stop errors */ }
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
    cooldownsRegion = createRegion(cooldownBar || cooldownBarFallback, 56, 4); // Assumed fixed size
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Cooldown bar marker coordinates missing');

  
  if (statusBar?.x !== undefined) {
    statusBarRegion = createRegion(statusBar, 104, 9); // Assumed fixed size
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Status bar marker coordinates missing');

  
  if (minimap?.x !== undefined) {
    minimapRegion = createRegion(minimap, 106, 1); // Use 106x1 slice
  } else if (config.logging.logRegionCaptureFailures) console.warn('[Init] Minimap marker coordinates missing');

  // --- Equipment Slots ---
  // Assuming fixed size for slots for now (e.g., 32x32 based on common UI elements)
  // Adjust size if needed based on actual appearance
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


function calculateItemRegion(itemConfig, coords) {
    if (!itemConfig || !itemConfig.sequence || !coords) return null;
    const seqLength = itemConfig.sequence.length;
    if (seqLength === 0) return null;
   
    let width = (itemConfig.direction === 'horizontal') ? seqLength : 1;
    let height = (itemConfig.direction === 'horizontal') ? 1 : seqLength;
    
    return { x: coords.x, y: coords.y, width: Math.max(1, width), height: Math.max(1, height) };
}


function initializeSpecialRegions(initialImageData) {
  if (!initialImageData || !dimensions) { console.warn('Cannot init special regions: missing data'); return; }
  locatedActionItems = []; 

  // --- Battle List ---
  if (config.captureRegions.battleList.enabled) {
    if(config.logging.logInitialization) console.log('[Init] Initializing battle list region...');
    
    const region = findBoundingRegionHelper(regionColorSequences.battleListStart, regionColorSequences.battleListEnd, 169, dimensions.height);
    battleListRegion = validateRegionDimensions(region) ? region : null;
    if(config.logging.logInitialization) console.log(`[Init] Battle list region ${battleListRegion ? 'found' : 'NOT found'}.`);
  }

  // --- Party List ---
  if (config.captureRegions.partyList.enabled) {
     if(config.logging.logInitialization) console.log('[Init] Initializing party list region...');
    const region = findBoundingRegionHelper(regionColorSequences.partyListStart, regionColorSequences.partyListEnd, 169, dimensions.height);
    partyListRegion = validateRegionDimensions(region) ? region : null;
     if(config.logging.logInitialization) console.log(`[Init] Party list region ${partyListRegion ? 'found' : 'NOT found'}.`);
  }

  // --- Action Bar Items ---
  if (config.captureRegions.actionBars.enabled) {
     if(config.logging.logInitialization) console.log('[Init] Initializing action bars...');
    
    const region = findBoundingRegionHelper(regionColorSequences.hotkeyBarBottomStart, regionColorSequences.hotkeyBarBottomEnd, dimensions.width, dimensions.height / 2); // Search bottom half
    overallActionBarsRegion = validateRegionDimensions(region) ? region : null;

    if (overallActionBarsRegion) {
        if(config.logging.logInitialization) console.log('[Init] Overall action bar region found:', overallActionBarsRegion);
        
        try {
            if(config.logging.logInitialization) console.log('[Init] Scanning for action items within region...');
            
            const initialFoundItems = findSequencesNative(initialImageData, actionBarItems, overallActionBarsRegion, "first");

            if (initialFoundItems) {
                 for (const [name, coords] of Object.entries(initialFoundItems)) {
                    
                    if (coords && actionBarItems[name]) {
                        const itemConfig = actionBarItems[name];
                        const itemRegion = calculateItemRegion(itemConfig, coords); // Calculate item's own small region
                        if (validateRegionDimensions(itemRegion)) {

                            locatedActionItems.push({
                                name,
                                originalCoords: { ...coords }, 
                                sequence: itemConfig.sequence, 
                                region: itemRegion, 
                                direction: itemConfig.direction || 'horizontal',
                            });
                        } else if (config.logging.logRegionCaptureFailures) console.warn(`[Init] Invalid region calculated for action item ${name} at`, coords);
                    }
                 }
                 if(config.logging.logInitialization) console.log(`[Init] Found and stored ${locatedActionItems.length} potential action item locations.`);
            } else {
                
                 if(config.logging.logInitialization) console.log('[Init] No initial action items found in the region.');
            }
        } catch (error) {
            
            console.error("[Init] Error during action item scan:", error);
            locatedActionItems = [];
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
    itemsLocated: locatedActionItems.length,
    amuletSlot: !!amuletSlotRegion, // <-- Add amulet status
    ringSlot: !!ringSlotRegion,     // <-- Add ring status
  };
 
  let body = `Init: HP:${status.hpMana?'✅':'❌'} CD:${status.cooldowns?'✅':'❌'} Status:${status.statusBar?'✅':'❌'} Map:${status.minimap?'✅':'❌'} `
            +`Equip:[Am:${status.amuletSlot?'✅':'❌'} Rg:${status.ringSlot?'✅':'❌'}] ` // <-- Add Equip section
            +`Battle:${status.battleList?'✅':'❌'} Party:${status.partyList?'✅':'❌'} Actions:${status.actionBars?'✅':'❌'}(${status.itemsLocated})`;
  parentPort.postMessage({ notification: { title: 'Monitor Status', body: body } });
}


function handleResizeStart(newDimensions) {
  console.warn(`Resize detected/triggered. New dimensions: ${newDimensions?.width}x${newDimensions?.height}`);
  dimensions = newDimensions; // Update current dimensions state
  lastDimensions = newDimensions ? { ...newDimensions } : null; // Update baseline for next check
  parentPort.postMessage({ notification: { title: 'Monitor Warning', body: 'Window Size Changed - Re-initializing...' } });
  initialized = false; // Mark as needing init
  shouldRestart = true; // Signal main loop to re-init
  resetRegions(); // Clear old region data
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

// Finds dynamic markers (cooldowns, status, action items, equipped items) in the current frame
function processDynamicRegions(frameDataBuffer) {
    const results = { cooldowns: {}, statusBar: {}, actionItems: {}, equipped: {} }; // Add 'equipped' to results
    if (!frameDataBuffer || !findSequencesNative) return results; // Need buffer and native function

    // Find Cooldown Markers within the defined cooldownsRegion
    if (config.captureRegions.cooldowns.enabled && cooldownsRegion) {
        try {
            // Use "first" mode as we only care if the marker exists
            results.cooldowns = findSequencesNative(frameDataBuffer, cooldownColorSequences, cooldownsRegion, "first") || {};
        } catch (e) { console.error("Error finding cooldowns:", e); }
    }

    // Find Status Bar Markers within the defined statusBarRegion
    if (config.captureRegions.statusBar.enabled && statusBarRegion) {
        try {
            // Use "first" mode
            results.statusBar = findSequencesNative(frameDataBuffer, statusBarSequences, statusBarRegion, "first") || {};
        } catch(e) { console.error("Error finding status bars:", e); }
    }

    // Verify initially located Action Items within the overallActionBarsRegion
    if (config.captureRegions.actionBars.enabled && overallActionBarsRegion) {
         try {
             // Scan for all defined action items within the container region using "first" mode
             // This tells us which items are *currently visible* in the container
             const currentFoundItemsMap = findSequencesNative(frameDataBuffer, actionBarItems, overallActionBarsRegion, "first") || {};

             // Cross-reference with items located during initialization
             const verifiedItems = {};
             for (const locatedItem of locatedActionItems) {
                 // Check if an item with the same name was found *now*
                 const currentCoords = currentFoundItemsMap[locatedItem.name];
                 // Check if it was found AND if its current coords match the initial coords
                 if (currentCoords && currentCoords.x === locatedItem.originalCoords.x && currentCoords.y === locatedItem.originalCoords.y) {
                     verifiedItems[locatedItem.name] = currentCoords; // Mark as active at its original spot
                 }
             }
             results.actionItems = verifiedItems; // Store the map of verified active items

             // --- Notify on Action Item Count Change ---
             const currentActionItemCount = Object.keys(results.actionItems).length;
            //  if (previousActionItemCount !== -1 && currentActionItemCount !== previousActionItemCount) {
            //      parentPort.postMessage({
            //          notification: {
            //              title: 'Monitor Info',
            //              body: `Action Bar Items Changed: ${currentActionItemCount} detected (was ${previousActionItemCount})`
            //          }
            //      });
            //  }
             previousActionItemCount = currentActionItemCount; // Update the count for the next cycle
             // --- End Notification Logic ---


             // Optional logging of active items
             if (config.logging.logActiveActionItems) {
                 const activeNames = Object.keys(results.actionItems);
                if (activeNames.length > 0) {
                    // 1. Group items by category
                    const groupedItems = {};
                    for (const itemName of activeNames) {
                        const itemConfig = actionBarItems[itemName];
                        if (itemConfig && itemConfig.categories) {
                            itemConfig.categories.forEach(category => {
                                if (!groupedItems[category]) {
                                    groupedItems[category] = [];
                                }
                                groupedItems[category].push(itemName);
                            });
                        } else { // Handle items possibly without categories
                           const category = 'Uncategorized';
                           if (!groupedItems[category]) groupedItems[category] = [];
                           groupedItems[category].push(itemName);
                        }
                    }

                    // 2. Prepare data for console.table (categories as columns)
                    const categories = Object.keys(groupedItems);
                    const maxItems = categories.length > 0 ? Math.max(...Object.values(groupedItems).map(arr => arr.length)) : 0;
                    const tableData = [];

                    for (let i = 0; i < maxItems; i++) {
                        const row = {};
                        for (const category of categories) {
                            const itemKey = groupedItems[category][i];
                            const itemName = itemKey ? actionBarItems[itemKey]?.name : '';
                            row[category] = itemName || '';
                        }
                        tableData.push(row);
                    }

                    // 3. Log the table
                    console.log("[Monitor] Active Action Items by Category:");
                    if (tableData.length > 0) {
                        console.table(tableData, categories);
                    } else {
                        console.log("(None detected this cycle)");
                    }
                }
             }
         } catch(e) { console.error("Error finding/verifying action items:", e); }
    }

    // --- Scan Equipment Slots ---
    // Scan Amulet Slot
    if (amuletSlotRegion && validateRegionDimensions(amuletSlotRegion)) {
        try {
            // Search for *any* item defined in equippedItems within the amulet slot region
            const foundItems = findSequencesNative(frameDataBuffer, equippedItems, amuletSlotRegion, "first");
            // Find the first item that was actually found (coords are not null)
            const detectedItemName = Object.keys(foundItems).find(key => foundItems[key] !== null);
            results.equipped.amulet = detectedItemName || null; // Store name or null
            detectedAmulet = results.equipped.amulet; // Update worker state

            // Optional: Log only if the detected item changes or on the first detection
            // if (detectedAmulet !== previousDetectedAmulet) {
            //     console.log(`[Monitor] Detected Amulet: ${detectedAmulet || 'None'}`);
            //     previousDetectedAmulet = detectedAmulet; // Update previous state for change detection
            // }

        } catch (e) { console.error("Error scanning amulet slot:", e); results.equipped.amulet = null; detectedAmulet = null; }
    } else {
        results.equipped.amulet = null; // No region, no item
        detectedAmulet = null;
    }

    // Scan Ring Slot
    if (ringSlotRegion && validateRegionDimensions(ringSlotRegion)) {
         try {
             const foundItems = findSequencesNative(frameDataBuffer, equippedItems, ringSlotRegion, "first");
             const detectedItemName = Object.keys(foundItems).find(key => foundItems[key] !== null);
             results.equipped.ring = detectedItemName || null;
             detectedRing = results.equipped.ring;

            // Optional: Log only if the detected item changes
            // if (detectedRing !== previousDetectedRing) {
            //     console.log(`[Monitor] Detected Ring: ${detectedRing || 'None'}`);
            //     previousDetectedRing = detectedRing;
            // }

         } catch (e) { console.error("Error scanning ring slot:", e); results.equipped.ring = null; detectedRing = null;}
    } else {
        results.equipped.ring = null; // No region, no item
        detectedRing = null;
    }

    // Log detected equipment every cycle if enabled
    if (config.logging.logEquippedItems) {
        console.log(`[Monitor] Equipment -> Amulet: ${detectedAmulet || 'None'}, Ring: ${detectedRing || 'None'}`);
    }
    // --- End Scan Equipment Slots ---

    return results;
}

// Processes static data regions and calls minimap check
function processCapturedData(fullFrameData, dynamicRegionResults) {
  // Basic check: If HP/Mana region enabled but no frame, trigger restart
  if (config.captureRegions.hpMana.enabled && !fullFrameData) {
      console.warn('HP/Mana region enabled but frame capture failed. Triggering re-initialization.');
      shouldRestart = true;
      return null; // Indicate failure/restart needed
  }

  // Check minimap for changes if enabled
  if (config.processing.trackMinimap && minimapRegion && fullFrameData?.data) {
       handleMinimapChange(fullFrameData.data, minimapRegion); // Pass fullFrameData.data
  }

  // Return the results from dynamic region processing (cooldowns, status, actions)
  return dynamicRegionResults;
}

// Calculates HP and Mana percentages
function calculateHealthAndMana(fullFrameData) {
  // Check if necessary data is available
  if (!hpbar || !mpbar || !hpManaRegion || !fullFrameData?.data || !dimensions) {
      return { newHealthPercentage: -1, newManaPercentage: -1 };
  }

  const health = calculatePercentages(
      fullFrameData.data,      // Full buffer (with header)
      dimensions.width,        // Full frame width
      hpManaRegion,            // Container region (absolute coords)
      hpbar,                   // Bar start relative to container {x, y}
      // BAR_PIXEL_WIDTH (94) is now implicit inside calculatePercentages
      resourceBars.healthBar   // Array of valid colors
  );

  const mana = calculatePercentages(
      fullFrameData.data,      // Full buffer (with header)
      dimensions.width,        // Full frame width
      hpManaRegion,            // Container region (absolute coords)
      mpbar,                   // Bar start relative to container {x, y}
      // BAR_PIXEL_WIDTH (94) is now implicit inside calculatePercentages
      resourceBars.manaBar     // Array of valid colors
  );

  return { newHealthPercentage: health, newManaPercentage: mana };
}

// Determines character status effects based on found markers
function getCharacterStatus(dynamicResults) {
  const status = {};
  const currentStatusBarRegions = dynamicResults?.statusBar || {};
  // Check if each status marker defined in constants was found
  Object.keys(statusBarSequences).forEach(key => {
      status[key] = currentStatusBarRegions[key]?.x !== undefined;
  });
  return status;
}

// Finds all battle list entries using native "all" mode
function getBattleListEntries(frameDataBuffer) {
  if (!battleListRegion || !frameDataBuffer) return [];
  if (typeof findSequencesNative !== 'function') { // Add check
       console.error("getBattleListEntries: findSequencesNative is not loaded!");
       return [];
  }
  try {
      // Pass findSequencesNative as the FIRST argument
      const entries = findAllOccurrences(
          findSequencesNative, // <-- PASS THE FUNCTION
          frameDataBuffer,
          battleListSequences.battleEntry, // Pass the config directly
          battleListRegion // Pass the search area
      );
      return entries; // findAllOccurrences already returns array or []
  } catch(e) {
      console.error("Error finding battle list entries:", e);
      return [];
  }
}

// Calculates HP percentage for a single party member bar
function calculatePartyHp(frameDataBuffer, barRegionInPartyList) {
    // Needs full frame, party list container, and the specific bar region (absolute coords)
    if (!frameDataBuffer || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(barRegionInPartyList)) return -1;
    try {
        // *** CRITICAL: Review 'calculatePartyHpPercentage' function ***
        // Ensure it handles:
        // 1. frameDataBuffer (full buffer with header)
        // 2. barStartIndexBytes (absolute byte offset calculated below)
        // 3. bar width
        // 4. HP bar color sequence definition
        const absoluteBarStartX = barRegionInPartyList.x;
        const absoluteBarStartY = barRegionInPartyList.y;
        // Use current frame dimensions for stride calculation
        if (!dimensions) { console.warn("Cannot calculate party HP, dimensions unknown."); return -1; }
        const fullBufferWidth = dimensions.width;
        const bytesPerPixel = 3;
        const headerSize = 8;
        // Calculate absolute byte offset from the start of the buffer's *data* section
        const barStartIndexBytesInData = (absoluteBarStartY * fullBufferWidth + absoluteBarStartX) * bytesPerPixel;
        const absoluteByteOffset = barStartIndexBytesInData + headerSize;

        // Check bounds against the full buffer length
        if (absoluteByteOffset < headerSize || absoluteByteOffset >= frameDataBuffer.length) {
             console.warn(`Calculated party HP bar start index (${absoluteByteOffset}) out of bounds.`);
             return -1;
        }
        // Pass the full buffer, let the helper extract data based on the calculated start index
        return calculatePartyHpPercentage(
            frameDataBuffer, // Pass the whole buffer
            resourceBars.partyEntryHpBar,
            absoluteByteOffset, // Absolute byte index in the buffer
            barRegionInPartyList.width // Width of the bar to scan
        );
    } catch (error) {
        console.error('Error calculating party HP:', error);
        return -1;
    }
}

// Checks if a party member is active based on name area markers
function checkPartyMemberStatus(frameDataBuffer, nameRegionInPartyList) {
  // Needs full frame and the absolute name region
  if (!frameDataBuffer || !validateRegionDimensions(partyListRegion) || !validateRegionDimensions(nameRegionInPartyList)) return false;
  try {
    // Search for *any* active status marker within the specific name region
    const statusResult = findSequencesNative(
        frameDataBuffer,
        PARTY_MEMBER_STATUS, // Object containing different status sequences
        nameRegionInPartyList, // Search area
        "first" // Mode - we only need one match
    );

    // Return true if any of the status markers were found (coords are not null)
    return statusResult && Object.values(statusResult).some(coords => coords !== null);
  } catch (error) {
    console.error('Error checking party member status:', error);
    return false;
  }
}

// Aggregates data for all party members
function getPartyData(frameDataBuffer) {
  // Needs party list container region and frame buffer
  if (!config.processing.handleParty || !validateRegionDimensions(partyListRegion) || !frameDataBuffer) return [];

  const partyData = [];
  const approxEntryHeight = 26; // Estimated height of a party entry
  // Calculate max entries based on container height
  const maxEntries = partyListRegion ? Math.floor(partyListRegion.height / approxEntryHeight) : 0;
  if (maxEntries <= 0) return [];

  // Calculate regions for each potential entry (these will have absolute coordinates)
  const partyEntryRegions = calculatePartyEntryRegions(partyListRegion, maxEntries);

  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i]; // Contains { bar, name, uhCoordinates } with absolute coords
    // Ensure both bar and name regions are valid before processing
    if (validateRegionDimensions(entry.bar) && validateRegionDimensions(entry.name)) {
      // Calculate HP and check status using the full frame buffer and absolute regions
      const hpPercentage = calculatePartyHp(frameDataBuffer, entry.bar);
      const isActive = checkPartyMemberStatus(frameDataBuffer, entry.name);

      // Only add member if HP calculation was successful
      if (hpPercentage >= 0) {
          partyData.push({ id: i, hpPercentage, uhCoordinates: entry.uhCoordinates, isActive });
      }
    }
  }
  return partyData;
}

// Executes the healing/support rules based on current game state
function runRules(fullFrameData, dynamicRegionResults) {
  if (!fullFrameData || !dynamicRegionResults) return;
  const frameDataBuffer = fullFrameData.data;

  // Calculate current player stats
  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(fullFrameData);
  // Get status effects, cooldowns, action items, equipped items from processed dynamic results
  const characterStatus = getCharacterStatus(dynamicRegionResults);
  const currentCooldownRegions = dynamicRegionResults.cooldowns || {};
  const activeActionItems = dynamicRegionResults.actionItems || {};
  const equippedItemsResult = dynamicRegionResults.equipped || {}; // <-- Get equipped items result
  // Get battle list and party data by scanning the current frame buffer
  const battleListEntries = getBattleListEntries(frameDataBuffer);
  const partyMembers = getPartyData(frameDataBuffer);

  // Update cooldown states
  if (currentCooldownRegions.attackInactive?.x !== undefined) cooldownManager.forceDeactivate('attack');
  if (currentCooldownRegions.healingInactive?.x !== undefined) cooldownManager.forceDeactivate('healing');
  if (currentCooldownRegions.supportInactive?.x !== undefined) cooldownManager.forceDeactivate('support');
  const healingCdActive = cooldownManager.updateCooldown('healing', currentCooldownRegions.healing?.x !== undefined);
  const supportCdActive = cooldownManager.updateCooldown('support', currentCooldownRegions.support?.x !== undefined);
  const attackCdActive = cooldownManager.updateCooldown('attack', currentCooldownRegions.attack?.x !== undefined);

  // Prepare input object for the rule processor
  const ruleInput = {
    hpPercentage: newHealthPercentage, manaPercentage: newManaPercentage,
    healingCdActive, supportCdActive, attackCdActive,
    characterStatus,
    monsterNum: battleListEntries.length, // Number of monsters on screen
    isWalking: minimapChanged, // Use state updated by handleMinimapChange
    partyMembers, // Array of party member data
    activeActionItems, // Map of currently active action bar items { name: {x, y} }
    equippedItems: { // <-- Add equipped items to rule input
        amulet: equippedItemsResult.amulet,
        ring: equippedItemsResult.ring,
        // Add other slots here later (e.g., boots, armor)
    },
  };
  // console.log(minimapChanged)
  // Get the currently active preset from the Redux state
  const currentPreset = state?.healing?.presets?.[state?.healing?.activePresetIndex];
  if (!currentPreset) {
      console.warn("No active healing preset found.");
      return; // Cannot run rules without a preset
  }

  // Process the rules
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Error during rule processing:', error);
  }
}

// Handles dispatching HP and Mana updates if they changed
function handleHealthAndManaUpdates(fullFrameData) {
  if(!fullFrameData) return;
  const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana(fullFrameData);

  // Dispatch only if value is valid (>=0) and different from last dispatched value
  if (newHealthPercentage >= 0 && newHealthPercentage !== lastDispatchedHealthPercentage) {
      dispatchHealthUpdate(newHealthPercentage);
      lastDispatchedHealthPercentage = newHealthPercentage; // Update last dispatched value
  }
  if (newManaPercentage >= 0 && newManaPercentage !== lastDispatchedManaPercentage) {
      dispatchManaUpdate(newManaPercentage);
      lastDispatchedManaPercentage = newManaPercentage; // Update last dispatched value
  }
}

// --- Main Loop ---
async function mainLoopIteration() {
  // --- Clear Terminal if Configured ---
  if (config.logging.clearTerminal) {
    // console.clear(); // This often doesn't work reliably from workers
    console.log('\x1Bc'); // Use ANSI escape code to clear terminal
  }

  const logPerf = config.logging.logPerformanceMetrics; // Cache the flag
  const logCapture = config.logging.logCaptureStatus; // Cache capture status flag
  const loopStart = logPerf ? performance.now() : 0;
  let initMs = 0, frameGetMs = 0, dimCheckMs = 0, dynamicRegionsMs = 0;
  let staticProcessMs = 0, rulesMs = 0, hpManaMs = 0, totalMs = 0;

  try {
    // --- Initialization Check ---
    if (needsInitialization()) {
      const initStart = logPerf ? performance.now() : 0;
      await initializeRegions();
      if (logPerf) initMs = performance.now() - initStart;
      // If initialization failed, wait and retry on the next loop
      if (!initialized) { await delay(1000); return; } // Exit early for this iteration
      // Reset FPS counter and successful frame time on init/re-init
      successfulFramesThisSecond = 0;
      lastFpsLogTime = Date.now();
      lastSuccessfulFrameTime = 0; // Ensure reset after potential init
    }

    // Proceed only if initialized
    if (initialized) {
      // --- 1. Get Latest Frame ---
      const frameGetStart = logPerf ? performance.now() : 0;
      if (logCapture) console.log('[ScreenMonitor] Attempting captureInstance.getLatestFrame()'); // Use config flag
      const frame = captureInstance.getLatestFrame();
      if (logPerf) frameGetMs = performance.now() - frameGetStart;

      let isUsingStaleData = false;

      if (!frame || !frame.data) {
          consecutiveFrameFailures++;
          isUsingStaleData = true;
          if (logCapture) { // Use config flag
              console.warn(`[ScreenMonitor] getLatestFrame FAILED. Consecutive failures: ${consecutiveFrameFailures}. Will use stale data if available.`);
          }
      } else {
          if (logCapture) { // Use config flag
               console.log(`[ScreenMonitor] getLatestFrame SUCCESS. Frame: ${frame.width}x${frame.height}, Length: ${frame.data?.length}`);
          }
          if (consecutiveFrameFailures > 0) {
              if (logCapture) { // Use config flag
                  console.log(`[ScreenMonitor] Resetting consecutiveFrameFailures from ${consecutiveFrameFailures} to 0.`);
              }
              consecutiveFrameFailures = 0;
          }
          currentFrameData = frame;
          isUsingStaleData = false;
          lastSuccessfulFrameTime = Date.now(); // <<<<<< UPDATE TIMESTAMP ON SUCCESS
      }

      if (!currentFrameData) {
          // Log error regardless of config flag? Or make it conditional too? Let's keep it for now.
          console.error("[ScreenMonitor] CRITICAL: No valid frame data (currentFrameData is null). Skipping cycle.");
          return;
      }

      if (isUsingStaleData && logCapture) { // Use config flag (and maybe only log if consecutive failures > 0?)
          console.warn(`[ScreenMonitor] Using stale frame data from previous cycle.`);
      }

      // --- FPS Counter Logic ---
      // Only count *successful* frames for FPS calculation
      if (!isUsingStaleData) {
          successfulFramesThisSecond++;
      }
      const now = Date.now();
      if (now - lastFpsLogTime >= 1000) {
          // Dispatch FPS update if it has changed
          if (successfulFramesThisSecond !== lastDispatchedFps) {
              dispatchFpsUpdate(successfulFramesThisSecond);
              lastDispatchedFps = successfulFramesThisSecond;
          }
          if (config.logging.logPerformanceMetrics) {
              console.log(`Perf: Captured FPS: ${successfulFramesThisSecond}`);
          }
          successfulFramesThisSecond = 0; // Reset counter
          lastFpsLogTime = now; // Update log time
      }
      // --- End FPS Counter Logic ---


      // --- 2. Dimension Check (Using currentFrameData) ---
      const dimCheckStart = logPerf ? performance.now() : 0;
      let dimensionsStable = true; // Assume stable initially
      // Check dimensions of the data we are *about to process* (which might be stale)
      if (!lastDimensions ||
          currentFrameData.width !== lastDimensions.width ||
          currentFrameData.height !== lastDimensions.height)
      {
          console.warn(`Frame dimensions ${currentFrameData.width}x${currentFrameData.height} differ from last known ${lastDimensions?.width}x${lastDimensions?.height}. Triggering resize.`);
          // Pass the dimensions from the (potentially stale) currentFrameData
          handleResizeStart({ width: currentFrameData.width, height: currentFrameData.height });
          dimensionsStable = false; // Mark as unstable
          if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
      }
      if (dimensionsStable) {
          // Update the 'current' dimensions variable based on the processed frame
          dimensions = { width: currentFrameData.width, height: currentFrameData.height };
      }
      if (logPerf) dimCheckMs = performance.now() - dimCheckStart;

      // If dimensions were not stable, skip the rest of the processing
      if (!dimensionsStable) {
          consecutiveFrameFailures = 0; // Reset counter on resize too
          successfulFramesThisSecond = 0;
          lastFpsLogTime = Date.now();
          return;
      }

      // --- Check if data is fresh enough to process ---
      const STALE_DATA_THRESHOLD_MS = 16; // Or 100, or 150. Revert from 16.
      const timeSinceLastSuccess = lastSuccessfulFrameTime > 0 ? Date.now() - lastSuccessfulFrameTime : Infinity;
      const canProcessData = !isUsingStaleData || timeSinceLastSuccess <= STALE_DATA_THRESHOLD_MS;

      if (canProcessData) {
        // --- Processing Steps (only if data is fresh enough) ---

        // --- 3. Process Dynamic Regions ---
        const dynamicRegionsStart = logPerf ? performance.now() : 0;
        // Pass the data from the potentially stale currentFrameData
        const dynamicRegionResults = processDynamicRegions(currentFrameData.data);
        if (logPerf) dynamicRegionsMs = performance.now() - dynamicRegionsStart;

        // --- 4. Process Static Data / Minimap ---
        const staticProcessStart = logPerf ? performance.now() : 0;
        // Pass the potentially stale currentFrameData
        const processedStatus = processCapturedData(currentFrameData, dynamicRegionResults);
        if (logPerf) staticProcessMs = performance.now() - staticProcessStart;

        if (processedStatus === null || shouldRestart) {
             console.log("Processing triggered restart.");
             if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
             consecutiveFrameFailures = 0;
             successfulFramesThisSecond = 0;
             lastFpsLogTime = Date.now();
             lastSuccessfulFrameTime = 0; // Reset on restart trigger
             return; // Exit early
        }

        // --- 5. Run Rules ---
        if (state?.global?.botEnabled) {
            const rulesStart = logPerf ? performance.now() : 0;
            try {
                // Pass the potentially stale currentFrameData
                runRules(currentFrameData, processedStatus);
            } catch (ruleError) {
                console.error('[ScreenMonitor] CRITICAL ERROR during rule processing:', ruleError);
                shouldRestart = true;
                initialized = false;
                consecutiveFrameFailures = 0;
                successfulFramesThisSecond = 0;
                lastFpsLogTime = Date.now();
                lastSuccessfulFrameTime = 0; // Reset on error
                if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore*/}
                return; // Stop this iteration
            }
            if (logPerf) rulesMs = performance.now() - rulesStart;
        }

        // --- 6. Handle HP/Mana Updates ---
        const hpManaStart = logPerf ? performance.now() : 0;
        // Pass the potentially stale currentFrameData
        handleHealthAndManaUpdates(currentFrameData);
        if (logPerf) hpManaMs = performance.now() - hpManaStart;

      } else {
          // Data is stale (frame capture failed AND last success > 200ms ago)
          if (logCapture) { // Log conditionally
              console.warn(`[ScreenMonitor] Skipping processing cycle. No new frame and last successful frame was ${timeSinceLastSuccess.toFixed(0)}ms ago (>${STALE_DATA_THRESHOLD_MS}ms threshold).`);
          }
          // Note: We might still want to run handleHealthAndManaUpdates based on stale data
          // if the threshold is relatively small, but for now, skipping all processing.
      }

    } // End if (initialized)

  } catch (err) { // Outer catch for loop-level errors
    console.error('[ScreenMonitor] Error in main loop iteration:', err);
    // Signal restart needed on error, clear initialized flag
    shouldRestart = true;
    initialized = false;
    consecutiveFrameFailures = 0; // Reset counter
    // Attempt to stop capture thread on error
    if (captureInstance) try { captureInstance.stopContinuousCapture(); } catch(e) {/*ignore stop errors*/}
    // Reset FPS counter on major loop error
    successfulFramesThisSecond = 0;
    lastFpsLogTime = Date.now();
    lastSuccessfulFrameTime = 0; // Reset on major loop error

  } finally {
    // --- Log Performance Metrics ---
    if (logPerf) {
       const loopEnd = performance.now();
       totalMs = loopEnd - loopStart;
       // Format numbers to 1 decimal place for readability
       const format = (ms) => ms.toFixed(1);
       console.log(
         `Perf: Total=${format(totalMs)}ms ` +
         `[Init=${format(initMs)} ` +
         `Frame=${format(frameGetMs)} ` +
         `DimChk=${format(dimCheckMs)} ` +
         `DynRg=${format(dynamicRegionsMs)} ` +
         `StatRg=${format(staticProcessMs)} ` +
         `Rules=${format(rulesMs)} ` +
         `HpMana=${format(hpManaMs)}]`
       );
    }
  }
}

// --- Worker Entry Point ---
async function start() {
  // Ensure running as a worker thread
  if (isMainThread) {
    console.error("[ScreenMonitor] This script must be run as a worker thread.");
    process.exit(1);
  }
  // Verify essential native modules loaded
  if (!captureInstance || !findSequencesNative) {
    console.error("[ScreenMonitor] Essential native dependencies failed to load.");
    // Notify parent about the failure
    if (parentPort) parentPort.postMessage({ fatalError: 'Missing native dependencies' });
    process.exit(1); // Exit worker
  }

  console.log('[ScreenMonitor] Worker started successfully.');
  lastFpsLogTime = Date.now(); // Initialize FPS log time at the very start

  // Start the main processing loop
  while (true) {
    const loopStart = performance.now(); // Use performance.now() for consistency if logging perf
    await mainLoopIteration(); // Execute one cycle
    const executionTime = performance.now() - loopStart;

    // --- Calculate Delay ---
    // Pass execution time and refresh rate from state to the utility function
    const delayTime = calculateDelayTime(executionTime, state?.global?.refreshRate);

    if (delayTime > 0) {
        if (config.logging.logPerformanceMetrics) { // Log delay conditionally
            // console.log(`Perf: Delaying for ${delayTime.toFixed(1)}ms`);
        }
        await delay(delayTime); // Wait if needed
    }
  }
}

// --- Event Listeners for Parent Communication ---

// Listen for state updates from the main process
parentPort.on('message', (message) => {
  // Check for command first
  if (message && message.command === 'forceReinitialize') {
      console.log('[ScreenMonitor] Received forceReinitialize command. Triggering re-initialization.');
      // Stop existing capture if it was running
      if (captureInstance && initialized) {
          try {
              captureInstance.stopContinuousCapture();
              console.log('[ScreenMonitor] Stopped capture due to forceReinitialize.');
          } catch (e) {
              console.error('[ScreenMonitor] Error stopping capture on forceReinitialize:', e);
          }
      }
      // Mark for re-initialization in the main loop
      initialized = false;
      shouldRestart = true; // Use existing flag to trigger initializeRegions
      currentRefreshRate = null; // Reset refresh rate tracking
      // state should be updated shortly after this command by the store update
      // currentWindowId = state?.global?.windowId; // No need to set here, rely on next state update
      resetRegions(); // Clear old region data immediately
      return; // Don't process as a state update
  }

  // --- Existing state update logic ---
  const previousWindowId = state?.global?.windowId; // Get ID from *previous* state
  const previousRefreshRate = currentRefreshRate; // Get previously set refresh rate
  const previousState = state; // Keep a reference to the old state for comparison

  state = message; // Update local state copy (assuming message IS the new state)
  const newWindowId = state?.global?.windowId;
  const newRefreshRateRaw = state?.global?.refreshRate;


  // --- Handle Window ID Change ---
  if (newWindowId && newWindowId !== previousWindowId) {
    console.log(`[ScreenMonitor] Window ID change detected via state update: ${previousWindowId} -> ${newWindowId}. Triggering re-initialization.`);

    // Stop existing capture if it was running for the previous window
    if (captureInstance && initialized) { // Check if initialized to avoid stopping unnecessarily
      try {
        captureInstance.stopContinuousCapture();
        console.log(`[ScreenMonitor] Stopped capture for old window ID ${previousWindowId}.`);
      } catch (e) {
        console.error(`[ScreenMonitor] Error stopping capture for old window ID ${previousWindowId}:`, e);
      }
    }

    // Mark for re-initialization in the main loop
    initialized = false;
    shouldRestart = true; // Use existing flag to trigger initializeRegions
    currentWindowId = newWindowId; // Update the tracked window ID
    currentRefreshRate = null; // Reset refresh rate, will be set on re-init
    resetRegions(); // Clear old region data immediately to prevent using stale data
    return; // Exit message handler early since we are restarting
  }

  // --- Handle Refresh Rate Change (only if window ID didn't change and initialized) ---
  if (initialized && typeof newRefreshRateRaw === 'number') {
      const newRefreshRateClamped = clampFps(newRefreshRateRaw);
      // Check if the *clamped* rate changed
      if (newRefreshRateClamped !== previousRefreshRate) {
          console.log(`[ScreenMonitor] Refresh rate change detected: ${previousRefreshRate} -> ${newRefreshRateClamped}. Updating target FPS.`);
          try {
              captureInstance.setTargetFPS(newRefreshRateClamped);
              currentRefreshRate = newRefreshRateClamped; // Update the tracked rate
          } catch (e) {
              if (e instanceof RangeError) {
                  console.error(`[ScreenMonitor] Error setting target FPS to ${newRefreshRateClamped} (from raw ${newRefreshRateRaw}): ${e.message}. Check state value.`);
                  // Potentially notify parent or try to recover, but for now just log
              } else {
                   console.error(`[ScreenMonitor] Unexpected error setting target FPS:`, e);
              }
              // Don't update currentRefreshRate if setting failed
          }
      }
  }
});

// Handle worker shutdown signal
parentPort.on('close', async () => {
  console.log('[ScreenMonitor] Parent port closed. Stopping capture and shutting down.');
  // Ensure capture thread is stopped cleanly
  if (captureInstance) {
      try { captureInstance.stopContinuousCapture(); } catch(e) { console.error("Error stopping capture on close:", e);}
  }
  // No Redis disconnect needed
  process.exit(0); // Exit worker process
});

// --- Start the Worker ---
start().catch(async (err) => { // Catch unhandled errors in start() or the main loop
  console.error('[ScreenMonitor] Worker encountered fatal error:', err);
  // Notify parent process of the fatal error
  if (parentPort) {
      parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  }
  // Attempt to stop capture thread before exiting
  if (captureInstance) {
      try { captureInstance.stopContinuousCapture(); } catch(e) { console.error("Error stopping capture on fatal error:", e);}
  }
  // No Redis disconnect needed
  process.exit(1); // Exit worker process with error code
});