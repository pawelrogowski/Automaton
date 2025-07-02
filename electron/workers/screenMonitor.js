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

// +++ ADDED: Setup for reading from Shared Buffers +++
const { sharedData } = workerData;
if (!sharedData) {
  throw new Error('[ScreenMonitor] Critical Error: Shared data was not provided by the worker manager.');
}
const { imageSAB, syncSAB } = sharedData;

// Create a typed array view for atomic operations on the sync buffer
const syncArray = new Int32Array(syncSAB);
const FRAME_COUNTER_INDEX = 0;
const WIDTH_INDEX = 1;
const HEIGHT_INDEX = 2;
const IS_RUNNING_INDEX = 3;
// --- END of new setup ---

// --- Constants and Performance Reporter ---
const TARGET_FPS = 16;
const MINIMAP_CHANGE_INTERVAL = 500;
const LOG_RULE_INPUT = false;

// --- Performance Reporting Configuration ---
const ENABLE_PERFORMANCE_REPORTING = false; // Set to true to enable performance logging
const REPORT_FILENAME = 'performance_report_monitor_sharedBuffer.json';
const REPORT_INTERVAL_MS = 10000;

/**
 * A real performance reporter that collects and saves metrics.
 */
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
      if (!this.metrics[name]) {
        this.metrics[name] = { calls: 0, totalTimeMs: 0, minMs: Infinity, maxMs: -Infinity, totalPixels: 0 };
      }
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
    if (now - this.lastReportTime > REPORT_INTERVAL_MS) {
      this.generateReport(false);
      this.lastReportTime = now;
    }
  }

  generateReport(isFinal = true) {
    const totalDurationSec = (performance.now() - this.startTime) / 1000;
    const totalFrames = this.frameTimings.length;
    if (totalFrames === 0) {
      if (isFinal) console.log('No frames processed, skipping performance report.');
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

/**
 * A dummy reporter that does nothing.
 */
class NoOpPerformanceReporter {
  start() {}
  end() {}
  startFrame() {}
  endFrame() {}
  generateReport() {}
}

const perfReporter = ENABLE_PERFORMANCE_REPORTING ? new PerformanceReporter() : new NoOpPerformanceReporter();

// --- State Variables ---
let state = null;
let initialized = false;
let shouldRestart = false;
let fullWindowBufferView = null;
let fullWindowBufferMetadata = { width: 0, height: 0, frameCounter: 0 };
let lastProcessedFrameCounter = -1;
let lastMinimapData = null;
let hpManaRegionDef,
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
let lastMinimapChangeTime = null;
let minimapChanged = false;
let lastKnownGoodHealthPercentage = null;
let lastKnownGoodManaPercentage = null;
let lastNotPossibleTimestamp = 0;
let lastThereIsNoWayTimestamp = 0;
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

  const maxInitAttempts = 50;
  let initSuccess = false;
  let initialSearchResults = null;

  for (let attempt = 1; attempt <= maxInitAttempts; attempt++) {
    const lastFrame = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    const waitResult = Atomics.wait(syncArray, FRAME_COUNTER_INDEX, lastFrame, 2000);

    if (waitResult === 'timed-out') {
      console.warn(`[ScreenMonitor] Timed out waiting for frame (Attempt ${attempt}/${maxInitAttempts})`);
      continue;
    }

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    if (width === 0 || height === 0) continue;

    fullWindowBufferView = Buffer.from(imageSAB, 0, width * height * 4);
    fullWindowBufferMetadata = { width, height, frameCounter: Atomics.load(syncArray, FRAME_COUNTER_INDEX) };

    const fullSearchArea = { x: 0, y: 0, width, height };
    const sanityCheckResult = findSequences.findSequencesNativeBatch(fullWindowBufferView, {
      sanityCheck: { sequences: { onlineMarker: regionColorSequences.onlineMarker }, searchArea: fullSearchArea, occurrence: 'first' },
    });

    if (sanityCheckResult?.sanityCheck?.onlineMarker) {
      perfReporter.start('A2. Initial Region Find');
      initialSearchResults = findSequences.findSequencesNativeBatch(fullWindowBufferView, {
        main: { sequences: regionColorSequences, searchArea: fullSearchArea, occurrence: 'first' },
      });
      perfReporter.end('A2. Initial Region Find', width * height);
      initSuccess = true;
      break;
    }
  }

  if (!initSuccess || !initialSearchResults?.main) {
    console.error('[ScreenMonitor] Initialization failed: Could not find critical UI elements.');
    shouldRestart = true;
    perfReporter.end('A. Initialize');
    return;
  }

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
  } catch (error) {
    console.error('[ScreenMonitor] Error during UI element location:', error);
    shouldRestart = true;
  }
  perfReporter.end('A. Initialize');
}

function notifyInitializationStatus() {
  const status = {
    hpMana: !!hpManaRegionDef,
    cooldowns: !!cooldownsRegionDef,
    statusBar: !!statusBarRegionDef,
    minimap: !!minimapRegionDef,
    battleList: !!battleListRegionDef?.startFound,
    partyList: !!partyListRegionDef?.startFound,
    actionBars: !!overallActionBarsRegionDef?.startFound,
    amuletSlot: !!amuletSlotRegionDef,
    ringSlot: !!ringSlotRegionDef,
    bootsSlot: !!bootsSlotRegionDef,
    onlineMarker: !!onlineMarkerRegionDef,
    chatOff: !!chatOffRegionDef,
  };
  let body =
    `HP:${status.hpMana ? '✅' : '❌'} CD:${status.cooldowns ? '✅' : '❌'} Status:${status.statusBar ? '✅' : '❌'} Map:${status.minimap ? '✅' : '❌'}  ` +
    `Equip:[Am:${status.amuletSlot ? '✅' : '❌'} Rg:${status.ringSlot ? '✅' : '❌'} Bt:${status.bootsSlot ? '✅' : '❌'}]  ` +
    `UI:[On:${status.onlineMarker ? '✅' : '❌'} Ch:${status.chatOff ? '✅' : '❌'}]  ` +
    `Battle:${status.battleList ? '✅' : '❌'} Party:${status.partyList ? '✅' : '❌'} Actions:${status.actionBars ? '✅' : '❌'}`;
  parentPort.postMessage({ notification: { title: 'Monitor Status', body: body } });
}

function handleMinimapChange() {
  if (!minimapRegionDef) {
    minimapChanged = false;
    return;
  }
  const now = Date.now();
  if (!lastMinimapChangeTime) lastMinimapChangeTime = now;
  if (now - lastMinimapChangeTime > MINIMAP_CHANGE_INTERVAL) {
    minimapChanged = false;
  } else {
    minimapChanged = true;
  }
}

function getPartyData() {
  if (!validateRegionDimensions(partyListRegionDef) || !fullWindowBufferView) return [];
  const partyData = [];
  const approxEntryHeight = 26;
  const maxEntries = Math.floor(partyListRegionDef.height / approxEntryHeight);
  if (maxEntries <= 0) return [];
  const partyEntryRegions = calculatePartyEntryRegions({ x: 0, y: 0 }, maxEntries);
  for (let i = 0; i < partyEntryRegions.length; i++) {
    const entry = partyEntryRegions[i];
    const absoluteBarCoords = { x: partyListRegionDef.x + entry.bar.x, y: partyListRegionDef.y + entry.bar.y };
    const hppc = calculatePartyHpPercentage(
      fullWindowBufferView,
      fullWindowBufferMetadata,
      absoluteBarCoords,
      resourceBars.partyEntryHpBar,
      130,
    );
    if (hppc >= 0) {
      partyData.push({ id: i, hppc, uhCoordinates: entry.uhCoordinates, isActive: true });
    }
  }
  return partyData;
}

function runRules(ruleInput) {
  perfReporter.start('E. Rule Engine');
  if (LOG_RULE_INPUT) console.log(ruleInput);
  const currentPreset = state?.rules?.presets?.[state?.rules?.activePresetIndex];
  if (!currentPreset) {
    perfReporter.end('E. Rule Engine');
    return;
  }
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Rule processing error:', error);
  }
  perfReporter.end('E. Rule Engine');
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

    perfReporter.start('B. Wait For Frame');
    const currentFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);
    if (currentFrameCounter === lastProcessedFrameCounter) {
      Atomics.wait(syncArray, FRAME_COUNTER_INDEX, currentFrameCounter, 1000);
    }
    const newFrameCounter = Atomics.load(syncArray, FRAME_COUNTER_INDEX);

    if (Atomics.load(syncArray, IS_RUNNING_INDEX) === 0) {
      console.log('[ScreenMonitor] Capture worker has stopped. Triggering re-initialization.');
      shouldRestart = true;
      initialized = false;
      perfReporter.end('B. Wait For Frame');
      return;
    }
    perfReporter.end('B. Wait For Frame');

    const width = Atomics.load(syncArray, WIDTH_INDEX);
    const height = Atomics.load(syncArray, HEIGHT_INDEX);
    if (width === 0 || height === 0) return;

    fullWindowBufferView = Buffer.from(imageSAB, 0, width * height * 4);
    fullWindowBufferMetadata = { width, height, frameCounter: newFrameCounter };

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

    perfReporter.start('C. Batch Search');
    const searchResults = findSequences.findSequencesNativeBatch(fullWindowBufferView, searchTasks);
    const totalPixelsSearched = Object.values(searchTasks).reduce((sum, task) => sum + task.searchArea.width * task.searchArea.height, 0);
    perfReporter.end('C. Batch Search', totalPixelsSearched);

    if (gameLogRegionDef) {
      perfReporter.start('F. OCR');
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
      perfReporter.end('F. OCR');
    }

    perfReporter.start('D. Data Processing');
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
    perfReporter.end('D. Data Processing');

    parentPort.postMessage({
      storeUpdate: true,
      type: 'gameState/updateGameStateFromMonitorData',
      payload: currentStateUpdate,
    });

    if (state?.global?.isBotEnabled) {
      runRules(currentStateUpdate);
    }
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
    console.log(`Font atlas loaded successfully with ${Object.keys(fontAtlasData).length} characters.`);
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
