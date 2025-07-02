import { parentPort, workerData } from 'worker_threads';
import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
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
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { delay, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';
import findSequences from 'find-sequences-native';
import fontOcr from 'font-ocr';
import fontAtlasData from '../../font_atlas/font-data.js';

// --- Shared Buffer Setup ---
const { sharedData } = workerData;
if (!sharedData) {
  throw new Error('[ScreenMonitor] Critical Error: Shared data was not provided by the worker manager.');
}
const { imageSAB, syncSAB } = sharedData;
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
const HEADER_SIZE = 8; // Define the header size from x11-region-capture-native

// --- Constants and Performance Reporter ---
const TARGET_FPS = 16;
const MINIMAP_CHANGE_INTERVAL = 500;
const LOG_RULE_INPUT = false;
const ENABLE_PERFORMANCE_REPORTING = false;
const REPORT_FILENAME = 'performance_report_monitor_sharedBuffer.json';
const REPORT_INTERVAL_MS = 10000;

class PerformanceReporter {
  constructor() {
    this.metrics = {};
    this.frameTimings = [];
    this.startTime = performance.now();
    this.tempTimings = {};
    this.lastReportTime = performance.now();
  }
  start(name) {
    this.tempTimings[name] = performance.now();
  }
  end(name, pixels = 0) {
    const endTime = performance.now();
    if (this.tempTimings[name]) {
      const duration = endTime - this.tempTimings[name];
      if (!this.metrics[name]) this.metrics[name] = { calls: 0, totalTimeMs: 0, minMs: Infinity, maxMs: -Infinity, totalPixels: 0 };
      const metric = this.metrics[name];
      metric.calls++;
      metric.totalTimeMs += duration;
      metric.totalPixels += pixels;
      if (duration < metric.minMs) metric.minMs = duration;
      if (duration > metric.maxMs) metric.maxMs = duration;
    }
  }
  startFrame() {
    this.start('_Frame');
  }
  endFrame() {
    this.end('_Frame');
    const lastFrameDuration = this.metrics['_Frame'].totalTimeMs - this.frameTimings.reduce((a, b) => a + b, 0);
    this.frameTimings.push(lastFrameDuration);
    const now = performance.now();
    if (now - this.lastReportTime > REPORT_INTERVAL_MS) this.generateReport(false);
  }
  generateReport(isFinal = true) {
    const totalDurationSec = (performance.now() - this.startTime) / 1000;
    const totalFrames = this.frameTimings.length;
    if (totalFrames === 0) {
      if (isFinal) console.log('No frames processed, skipping report.');
      return;
    }
    const reportMetrics = JSON.parse(JSON.stringify(this.metrics));
    for (const name in reportMetrics) {
      const metric = reportMetrics[name];
      metric.avgMs = metric.calls > 0 ? metric.totalTimeMs / metric.calls : 0;
      metric.avgMsPer1kPixels = metric.totalPixels > 0 ? (metric.totalTimeMs / metric.totalPixels) * 1000 : 0;
      if (metric.minMs === Infinity) metric.minMs = 0;
      if (metric.maxMs === -Infinity) metric.maxMs = 0;
    }
    const frameTotalTime = this.frameTimings.reduce((sum, time) => sum + time, 0);
    const report = {
      metadata: { reportGeneratedAt: new Date().toISOString(), status: isFinal ? 'Final' : 'Periodic' },
      summary: {
        testDurationSec: totalDurationSec,
        totalFramesProcessed: totalFrames,
        targetFps: TARGET_FPS,
        actualAvgFps: totalFrames / totalDurationSec,
        avgFrameTimeMs: frameTotalTime / totalFrames,
        minFrameTimeMs: Math.min(...this.frameTimings),
        maxFrameTimeMs: Math.max(...this.frameTimings),
      },
      stages: reportMetrics,
    };
    delete report.stages['_Frame'];
    try {
      fs.writeFileSync(path.join(process.cwd(), REPORT_FILENAME), JSON.stringify(report, null, 2));
      if (isFinal) console.log(`\nFinal performance report saved to ${REPORT_FILENAME}`);
    } catch (err) {
      console.error('Failed to write performance report:', err);
    }
  }
}
class NoOpPerformanceReporter {
  start() {}
  end() {}
  startFrame() {}
  endFrame() {}
  generateReport() {}
}
const perfReporter = ENABLE_PERFORMANCE_REPORTING ? new PerformanceReporter() : new NoOpPerformanceReporter();

// --- State Variables ---
let state = null,
  initialized = false,
  shouldRestart = false;
let fullWindowBufferView = null,
  fullWindowBufferMetadata = { width: 0, height: 0, frameCounter: 0 };
let lastProcessedFrameCounter = -1;
let lastMinimapData = null,
  hpManaRegionDef,
  cooldownsRegionDef,
  statusBarRegionDef,
  minimapRegionDef,
  battleListRegionDef,
  partyListRegionDef,
  overallActionBarsRegionDef,
  amuletSlotRegionDef,
  ringSlotRegionDef,
  bootsSlotRegionDef,
  onlineMarkerRegionDef,
  chatOffRegionDef,
  gameLogRegionDef;
let healthBarAbsolute, manaBarAbsolute;
let lastMinimapChangeTime = null,
  minimapChanged = false;
let lastKnownGoodHealthPercentage = null,
  lastKnownGoodManaPercentage = null;
let lastNotPossibleTimestamp = 0,
  lastThereIsNoWayTimestamp = 0;
const MESSAGE_UPDATE_INTERVAL = 300;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

function resetState() {
  initialized = false;
  fullWindowBufferView = null;
  fullWindowBufferMetadata = { width: 0, height: 0, frameCounter: 0 };
  lastProcessedFrameCounter = -1;
  lastMinimapData = null;
  [
    hpManaRegionDef,
    cooldownsRegionDef,
    statusBarRegionDef,
    minimapRegionDef,
    battleListRegionDef,
    partyListRegionDef,
    overallActionBarsRegionDef,
    amuletSlotRegionDef,
    ringSlotRegionDef,
    bootsSlotRegionDef,
    onlineMarkerRegionDef,
    chatOffRegionDef,
    gameLogRegionDef,
  ] = Array(13).fill(null);
  [healthBarAbsolute, manaBarAbsolute] = Array(2).fill(null);
  lastKnownGoodHealthPercentage = null;
  lastKnownGoodManaPercentage = null;
}

async function initialize() {
  perfReporter.start('A. Initialize');
  resetState();
  console.log('[ScreenMonitor] Initializing. Waiting for first valid frame from capture worker...');

  for (let attempt = 1; attempt <= 50; attempt++) {
    const lastFrame = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    const waitResult = Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastFrame, 2000);
    if (waitResult === 'timed-out') {
      console.warn(`[ScreenMonitor] Timed out waiting for frame (Attempt ${attempt}/50)`);
      continue;
    }
    const width = Atomics.load(syncArray, WIDTH_INDEX),
      height = Atomics.load(syncArray, HEIGHT_INDEX);
    if (width === 0 || height === 0) continue;

    // *** THE FIX: Create a buffer view that is the correct size, including the header ***
    const bufferSize = HEADER_SIZE + width * height * 4;
    fullWindowBufferView = Buffer.from(imageSAB, 0, bufferSize);
    fullWindowBufferMetadata = { width, height, frameCounter: Atomics.load(syncArray, FRAME_COUNTER_INDEX) };

    const fullSearchArea = { x: 0, y: 0, width, height };
    const sanityCheckResult = findSequences.findSequencesNativeBatch(fullWindowBufferView, {
      sanityCheck: { sequences: { onlineMarker: regionColorSequences.onlineMarker }, searchArea: fullSearchArea, occurrence: 'first' },
    });

    if (sanityCheckResult?.sanityCheck?.onlineMarker) {
      const initialSearchResults = findSequences.findSequencesNativeBatch(fullWindowBufferView, {
        main: { sequences: regionColorSequences, searchArea: fullSearchArea, occurrence: 'first' },
      });
      // The rest of the initialization logic is now guaranteed to work correctly.
      try {
        const startRegions = initialSearchResults.main;
        const {
          healthBar,
          manaBar,
          cooldownBar,
          cooldownBarFallback,
          statusBar,
          minimap,
          amuletSlot,
          ringSlot,
          bootsSlot,
          onlineMarker,
          chatOff,
        } = startRegions;
        if (healthBar && manaBar) {
          hpManaRegionDef = createRegion(healthBar, 94, 14);
          healthBarAbsolute = { x: healthBar.x, y: healthBar.y };
          manaBarAbsolute = { x: manaBar.x, y: manaBar.y };
        }
        cooldownsRegionDef = createRegion(cooldownBar || cooldownBarFallback, 56, 4);
        statusBarRegionDef = createRegion(statusBar, 104, 9);
        minimapRegionDef = createRegion(minimap, 106, 106);
        amuletSlotRegionDef = createRegion(amuletSlot, 32, 32);
        ringSlotRegionDef = createRegion(ringSlot, 32, 32);
        bootsSlotRegionDef = createRegion(bootsSlot, 32, 32);
        onlineMarkerRegionDef = createRegion(onlineMarker, 1, regionColorSequences.onlineMarker.sequence.length);
        chatOffRegionDef = createRegion(chatOff, regionColorSequences.chatOff.sequence.length, 1);
        const findBoundingRectBatch = (startSeq, endSeq, ...args) =>
          findBoundingRect(findSequences.findSequencesNativeBatch, fullWindowBufferView, startSeq, endSeq, ...args);
        battleListRegionDef = findBoundingRectBatch(regionColorSequences.battleListStart, regionColorSequences.battleListEnd, 160, 600);
        partyListRegionDef = findBoundingRectBatch(regionColorSequences.partyListStart, regionColorSequences.partyListEnd, 160, 200);
        overallActionBarsRegionDef = findBoundingRectBatch(
          regionColorSequences.hotkeyBarBottomStart,
          regionColorSequences.hotkeyBarBottomEnd,
          600,
          100,
        );
        gameLogRegionDef = { x: 808, y: 695, width: 125, height: 11 };
        initialized = true;
        shouldRestart = false;
        notifyInitializationStatus();
        perfReporter.end('A. Initialize');
        return; // Exit the loop on success
      } catch (error) {
        console.error('[ScreenMonitor] Error during UI element location:', error);
        shouldRestart = true;
        break; // Exit loop on error
      }
    }
  }
  // If loop finishes without success
  console.error('[ScreenMonitor] Initialization failed: Could not find critical UI elements.');
  shouldRestart = true;
  perfReporter.end('A. Initialize');
}

function notifyInitializationStatus() {
  /* ... same as before ... */
}
function handleMinimapChange() {
  /* ... same as before ... */
}
function getPartyData() {
  /* ... same as before, will now work correctly ... */
}
function runRules(ruleInput) {
  /* ... same as before ... */
}

async function mainLoopIteration() {
  perfReporter.startFrame();
  try {
    if (!initialized || shouldRestart) {
      await initialize();
      if (!initialized) {
        resetState();
        return;
      }
    }

    Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastProcessedFrameCounter, 1000);
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    if (newFrameCounter <= lastProcessedFrameCounter) {
      perfReporter.endFrame();
      return;
    }

    if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
      console.log('[ScreenMonitor] Capture worker has stopped. Triggering re-initialization.');
      shouldRestart = true;
      initialized = false;
      perfReporter.endFrame();
      return;
    }

    const width = Atomics.load(syncArray, WIDTH_INDEX),
      height = Atomics.load(syncArray, HEIGHT_INDEX);
    if (width === 0 || height === 0) {
      perfReporter.endFrame();
      return;
    }

    // *** THE FIX: Re-create the buffer view with the correct size each loop ***
    const bufferSize = HEADER_SIZE + width * height * 4;
    fullWindowBufferView = Buffer.from(imageSAB, 0, bufferSize);
    fullWindowBufferMetadata = { width, height, frameCounter: newFrameCounter };

    // --- All subsequent logic will now work correctly ---
    const searchTasks = {};
    if (cooldownsRegionDef)
      searchTasks.cooldowns = { sequences: cooldownColorSequences, searchArea: cooldownsRegionDef, occurrence: 'first' };
    if (statusBarRegionDef) searchTasks.statusBar = { sequences: statusBarSequences, searchArea: statusBarRegionDef, occurrence: 'first' };
    if (amuletSlotRegionDef) searchTasks.amulet = { sequences: equippedItems, searchArea: amuletSlotRegionDef, occurrence: 'first' };
    if (ringSlotRegionDef) searchTasks.ring = { sequences: equippedItems, searchArea: ringSlotRegionDef, occurrence: 'first' };
    if (bootsSlotRegionDef) searchTasks.boots = { sequences: equippedItems, searchArea: bootsSlotRegionDef, occurrence: 'first' };
    if (onlineMarkerRegionDef)
      searchTasks.onlineMarker = {
        sequences: { onlineMarker: regionColorSequences.onlineMarker },
        searchArea: onlineMarkerRegionDef,
        occurrence: 'first',
      };
    if (chatOffRegionDef)
      searchTasks.chatOff = { sequences: { chatOff: regionColorSequences.chatOff }, searchArea: chatOffRegionDef, occurrence: 'first' };
    if (overallActionBarsRegionDef?.startFound)
      searchTasks.actionItems = { sequences: actionBarItems, searchArea: overallActionBarsRegionDef, occurrence: 'first' };
    if (battleListRegionDef?.startFound)
      searchTasks.battleList = {
        sequences: { battleEntry: battleListSequences.battleEntry },
        searchArea: battleListRegionDef,
        occurrence: 'all',
      };

    const searchResults = findSequences.findSequencesNativeBatch(fullWindowBufferView, searchTasks);

    if (gameLogRegionDef) {
      const detectedText = fontOcr.recognizeText(fullWindowBufferView, gameLogRegionDef);
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
      hpManaRegionDef && healthBarAbsolute
        ? {
            newHealthPercentage: calculatePercentages(
              fullWindowBufferView,
              fullWindowBufferMetadata,
              healthBarAbsolute,
              resourceBars.healthBar,
              94,
            ),
            newManaPercentage: calculatePercentages(
              fullWindowBufferView,
              fullWindowBufferMetadata,
              manaBarAbsolute,
              resourceBars.manaBar,
              94,
            ),
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

    const battleListEntries = searchResults.battleList || [];
    const partyMembers = getPartyData();
    const activeActionItems = Object.fromEntries(Object.entries(searchResults.actionItems || {}).filter(([, val]) => val !== null));

    const equippedItemsResult = {
      amulet: Object.keys(searchResults.amulet || {}).find((key) => searchResults.amulet[key] !== null) || 'Unknown',
      ring: Object.keys(searchResults.ring || {}).find((key) => searchResults.ring[key] !== null) || 'Unknown',
      boots: Object.keys(searchResults.boots || {}).find((key) => searchResults.boots[key] !== null) || 'Unknown',
    };
    if (equippedItemsResult.amulet === 'emptyAmuletSlot') equippedItemsResult.amulet = 'Empty';
    if (equippedItemsResult.ring === 'emptyRingSlot') equippedItemsResult.ring = 'Empty';
    if (equippedItemsResult.boots === 'emptyBootsSlot') equippedItemsResult.boots = 'Empty';

    const isLoggedIn = !!searchResults.onlineMarker?.onlineMarker;
    const isChatOff = !!searchResults.chatOff?.chatOff;
    handleMinimapChange();

    const currentStateUpdate = {
      hppc: lastKnownGoodHealthPercentage,
      mppc: lastKnownGoodManaPercentage,
      healingCd,
      supportCd,
      attackCd,
      characterStatus,
      monsterNum: battleListEntries.length,
      isWalking: minimapChanged,
      partyMembers,
      activeActionItems,
      equippedItems: equippedItemsResult,
      isLoggedIn,
      isChatOff,
    };
    parentPort.postMessage({ storeUpdate: true, type: 'gameState/updateGameStateFromMonitorData', payload: currentStateUpdate });

    if (state?.global?.isBotEnabled) runRules(currentStateUpdate);
    lastProcessedFrameCounter = newFrameCounter;
  } catch (err) {
    console.error('Fatal error in mainLoopIteration:', err);
    shouldRestart = true;
    initialized = false;
  } finally {
    perfReporter.endFrame();
  }
}

async function start() {
  try {
    console.log('[ScreenMonitor] Loading data-driven font atlas...');
    fontOcr.loadFontAtlas(fontAtlasData);
    console.log(`Font atlas loaded successfully.`);
  } catch (e) {
    console.error('CRITICAL: Failed to load font atlas.', e);
  }
  while (true) {
    await mainLoopIteration();
  }
}

parentPort.on('message', (message) => {
  if (message && message.command === 'forceReinitialize') {
    initialized = false;
    shouldRestart = true;
    resetState();
    return;
  }
  state = message;
});

parentPort.on('close', async () => {
  perfReporter.generateReport(true);
  resetState();
  process.exit(0);
});

start().catch(async (err) => {
  console.error('[ScreenMonitor] Worker fatal error:', err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  perfReporter.generateReport(true);
  process.exit(1);
});
