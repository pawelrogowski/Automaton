import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
  equippedItems,
} from '../constants/index.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { delay, calculateDelayTime, createRegion, validateRegionDimensions } from './screenMonitor/modules/utils.js';

const require = createRequire(import.meta.url);
const paths = workerData?.paths || {};
const x11capturePath = paths.x11capture;
const findSequencesPath = paths.findSequences;
let X11RegionCapture = null;
let findSequencesNative = null;
try {
  ({ X11RegionCapture } = require(x11capturePath));
  ({ findSequencesNative } = require(findSequencesPath));
} catch (e) {
  parentPort.postMessage({ fatalError: `Failed to load native modules in screenMonitor: ${e.message}` });
  process.exit(1);
}

const TARGET_FPS = 32;
const MINIMAP_CHANGE_INTERVAL = 500;
const LOG_RULE_INPUT = false;

let state = null;
let initialized = false;
let shouldRestart = false;
let dimensions = null;
let fullWindowBuffer = null;
let fullWindowBufferMetadata = { width: 0, height: 0, timestamp: 0 };
let regionBuffers = new Map();
let currentRegionDataMap = null;
let startRegions = null;
let hpManaRegionDef = null;
let cooldownsRegionDef = null;
let statusBarRegionDef = null;
let minimapRegionDef = null;
let battleListRegionDef = null;
let partyListRegionDef = null;
let overallActionBarsRegionDef = null;
let amuletSlotRegionDef = null;
let ringSlotRegionDef = null;
let bootsSlotRegionDef = null;
let onlineMarkerRegionDef = null;
let chatOffRegionDef = null;
let monitoredRegionNames = [];
let initialActionItemsCountForNotification = 0;
let detectedAmulet = null;
let detectedRing = null;
let hpbarRelative = null;
let mpbarRelative = null;
let lastMinimapData = null;
let lastMinimapChangeTime = null;
let minimapChanged = false;
let lastKnownGoodHealthPercentage = null;
let lastKnownGoodManaPercentage = null;
let currentWindowId = null;

const captureInstance = X11RegionCapture ? new X11RegionCapture() : null;
const cooldownManager = new CooldownManager();
const ruleProcessorInstance = new RuleProcessor();

function resetRegions() {
  hpManaRegionDef = null;
  cooldownsRegionDef = null;
  statusBarRegionDef = null;
  minimapRegionDef = null;
  battleListRegionDef = null;
  partyListRegionDef = null;
  overallActionBarsRegionDef = null;
  amuletSlotRegionDef = null;
  ringSlotRegionDef = null;
  bootsSlotRegionDef = null;
  onlineMarkerRegionDef = null;
  chatOffRegionDef = null;
  monitoredRegionNames = [];
  fullWindowBuffer = null;
  fullWindowBufferMetadata = { width: 0, height: 0, timestamp: 0 };
  regionBuffers.clear();
  currentRegionDataMap = null;
  startRegions = null;
  hpbarRelative = null;
  mpbarRelative = null;
  lastMinimapData = null;
  initialActionItemsCountForNotification = 0;
  detectedAmulet = null;
  detectedRing = null;
  dimensions = null;
  lastKnownGoodHealthPercentage = null;
  lastKnownGoodManaPercentage = null;
}

function findBoundingRegionHelper(fullFrameDataBufferWithHeader, startSequence, endSequence, bufferWidth, bufferHeight) {
  if (
    !fullFrameDataBufferWithHeader ||
    fullFrameDataBufferWithHeader.length < 8 ||
    !bufferWidth ||
    !bufferHeight ||
    !startSequence ||
    !endSequence
  ) {
    return null;
  }
  try {
    const result = findBoundingRect(
      findSequencesNative,
      fullFrameDataBufferWithHeader,
      startSequence,
      endSequence,
      bufferWidth,
      bufferHeight,
    );
    if (!result?.startFound) {
      return { x: 0, y: 0, width: 0, height: 0, startFound: false, endFound: false, error: 'Start sequence not found' };
    }
    const finalRect = result;
    if (!result?.endFound) {
      return result;
    }
    if (
      finalRect.x < 0 ||
      finalRect.y < 0 ||
      finalRect.x + finalRect.width > bufferWidth ||
      finalRect.y + finalRect.height > bufferHeight
    ) {
      return null;
    }
    return finalRect;
  } catch (error) {
    return null;
  }
}

function addAndTrackRegion(name, x, y, width, height) {
  const regionConfig = { regionName: name, winX: x, winY: y, regionWidth: width, regionHeight: height };
  try {
    captureInstance.addRegionToMonitor(regionConfig);
    monitoredRegionNames.push(name);
    const bufferSize = width * height * 3 + 8;
    const buffer = Buffer.alloc(bufferSize);
    regionBuffers.set(name, { buffer, x, y, width, height, timestamp: 0 });
    return regionConfig;
  } catch (e) {
    return null;
  }
}

async function initializeRegions() {
  if (!state?.global?.windowId) {
    initialized = false;
    shouldRestart = true;
    return;
  }
  resetRegions();
  let initialFullFrameResult = null;
  try {
    const windowId = state.global.windowId;
    captureInstance.startMonitorInstance(windowId, TARGET_FPS);
  } catch (startError) {
    initialized = false;
    shouldRestart = true;
    resetRegions();
    return;
  }
  const estimatedMaxSize = 2560 * 1600 * 3 + 8;
  fullWindowBuffer = Buffer.alloc(estimatedMaxSize);
  initialFullFrameResult = captureInstance.getFullWindowImageData(fullWindowBuffer);
  if (!initialFullFrameResult?.success) {
    throw new Error(`Failed to get initial full window frame. Result: ${JSON.stringify(initialFullFrameResult)}`);
  }
  fullWindowBufferMetadata = {
    width: initialFullFrameResult.width,
    height: initialFullFrameResult.height,
    timestamp: initialFullFrameResult.captureTimestampUs,
  };
  dimensions = { width: fullWindowBufferMetadata.width, height: fullWindowBufferMetadata.height };
  try {
    const fullFrameDataWithHeader = fullWindowBuffer;
    startRegions = findSequencesNative(fullFrameDataWithHeader, regionColorSequences, null, 'first');
    initializeStandardRegions();
    initializeSpecialRegions(fullFrameDataWithHeader, dimensions.width, dimensions.height);
    initialized = true;
    shouldRestart = false;
    notifyInitializationStatus();
    fullWindowBuffer = null;
    fullWindowBufferMetadata = { width: 0, height: 0, timestamp: 0 };
  } catch (error) {
    initialized = false;
    shouldRestart = true;
    dimensions = null;
    currentWindowId = null;
    resetRegions();
    if (captureInstance && state?.global?.windowId) {
      try {
        captureInstance.stopMonitorInstance();
      } catch (e) {}
    }
  }
}

function initializeStandardRegions() {
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

  const hpManaDef = createRegion(healthBar, 94, 14);
  if (hpManaDef) {
    hpManaRegionDef = addAndTrackRegion('hpManaRegion', hpManaDef.x, hpManaDef.y, hpManaDef.width, hpManaDef.height);
    if (hpManaRegionDef) {
      hpbarRelative = { x: healthBar.x - hpManaRegionDef.winX, y: healthBar.y - hpManaRegionDef.winY };
      mpbarRelative = { x: manaBar.x - hpManaRegionDef.winX, y: manaBar.y - hpManaRegionDef.winY };
    }
  }

  if (cooldownBar?.x !== undefined || cooldownBarFallback?.x !== undefined) {
    const cooldownsDef = createRegion(cooldownBar || cooldownBarFallback, 56, 4);
    if (cooldownsDef) {
      cooldownsRegionDef = addAndTrackRegion('cooldownsRegion', cooldownsDef.x, cooldownsDef.y, cooldownsDef.width, cooldownsDef.height);
    }
  }
  if (statusBar?.x !== undefined) {
    const statusBarDef = createRegion(statusBar, 104, 9);
    if (statusBarDef) {
      statusBarRegionDef = addAndTrackRegion('statusBarRegion', statusBarDef.x, statusBarDef.y, statusBarDef.width, statusBarDef.height);
    }
  }
  if (minimap?.x !== undefined) {
    const minimapDef = createRegion(minimap, 106, 1);
    if (minimapDef) {
      minimapRegionDef = addAndTrackRegion('minimapRegion', minimapDef.x, minimapDef.y, minimapDef.width, minimapDef.height);
    }
  }
  const slotWidth = 32;
  const slotHeight = 32;
  if (amuletSlot?.x !== undefined) {
    const amuletSlotDef = createRegion(amuletSlot, slotWidth, slotHeight);
    if (amuletSlotDef) {
      amuletSlotRegionDef = addAndTrackRegion(
        'amuletSlotRegion',
        amuletSlotDef.x,
        amuletSlotDef.y,
        amuletSlotDef.width,
        amuletSlotDef.height,
      );
    }
  }
  if (ringSlot?.x !== undefined) {
    const ringSlotDef = createRegion(ringSlot, slotWidth, slotHeight);
    if (ringSlotDef) {
      ringSlotRegionDef = addAndTrackRegion('ringSlotRegion', ringSlotDef.x, ringSlotDef.y, ringSlotDef.width, ringSlotDef.height);
    }
  }
  if (bootsSlot?.x !== undefined) {
    const bootsSlotDef = createRegion(bootsSlot, slotWidth, slotHeight);
    if (bootsSlotDef) {
      bootsSlotRegionDef = addAndTrackRegion('bootsSlotRegion', bootsSlotDef.x, bootsSlotDef.y, bootsSlotDef.width, bootsSlotDef.height);
    }
  }
  // For onlineMarker and chatOff, we need a region large enough to contain the sequence.
  // The size should be based on the sequence length and direction.
  // Looking at regionColorSequences, onlineMarker is vertical sequence of 4. chatOff is horizontal sequence of 7.
  // Let's create a small region around the found start position to capture the sequence.
  const onlineMarkerWidth = 1; // Sequence is vertical, minimum width 1
  const onlineMarkerHeight = regionColorSequences.onlineMarker.sequence.length; // Height based on sequence length
  if (onlineMarker?.x !== undefined) {
    // createRegion will offset based on the sequence offset (0,0 in this case) and use provided width/height.
    const onlineMarkerDef = createRegion(onlineMarker, onlineMarkerWidth, onlineMarkerHeight);
    if (onlineMarkerDef) {
      onlineMarkerRegionDef = addAndTrackRegion(
        'onlineMarkerRegion',
        onlineMarkerDef.x,
        onlineMarkerDef.y,
        onlineMarkerDef.width,
        onlineMarkerDef.height,
      );
    }
  }
  const chatOffWidth = regionColorSequences.chatOff.sequence.length; // Width based on sequence length
  const chatOffHeight = 1; // Sequence is horizontal, minimum height 1
  if (chatOff?.x !== undefined) {
    // createRegion will offset based on the sequence offset (0,0 in this case) and use provided width/height.
    const chatOffDef = createRegion(chatOff, chatOffWidth, chatOffHeight);
    if (chatOffDef) {
      chatOffRegionDef = addAndTrackRegion('chatOffRegion', chatOffDef.x, chatOffDef.y, chatOffDef.width, chatOffDef.height);
    }
  }
}

function initializeSpecialRegions(initialFullImageDataWithHeader, fullImageWidth, fullImageHeight) {
  if (!initialFullImageDataWithHeader || initialFullImageDataWithHeader.length < 8 || fullImageWidth <= 0 || fullImageHeight <= 0) {
    initialActionItemsCountForNotification = 0;
    return;
  }
  initialActionItemsCountForNotification = 0;

  const battleListRegionDefAttempt = findBoundingRegionHelper(
    initialFullImageDataWithHeader,
    regionColorSequences.battleListStart,
    regionColorSequences.battleListEnd,
    fullImageWidth,
    fullImageHeight,
  );
  battleListRegionDef = validateRegionDimensions(battleListRegionDefAttempt)
    ? addAndTrackRegion(
        'battleListRegion',
        battleListRegionDefAttempt.x,
        battleListRegionDefAttempt.y,
        battleListRegionDefAttempt.width,
        battleListRegionDefAttempt.height,
      )
    : null;

  const partyListRegionDefAttempt = findBoundingRegionHelper(
    initialFullImageDataWithHeader,
    regionColorSequences.partyListStart,
    regionColorSequences.partyListEnd,
    fullImageWidth,
    fullImageHeight,
  );
  partyListRegionDef = validateRegionDimensions(partyListRegionDefAttempt)
    ? addAndTrackRegion(
        'partyListRegion',
        partyListRegionDefAttempt.x,
        partyListRegionDefAttempt.y,
        partyListRegionDefAttempt.width,
        partyListRegionDefAttempt.height,
      )
    : null;

  const overallActionBarsRegionDefAttempt = findBoundingRegionHelper(
    initialFullImageDataWithHeader,
    regionColorSequences.hotkeyBarBottomStart,
    regionColorSequences.hotkeyBarBottomEnd,
    fullImageWidth,
    fullImageHeight,
  );
  overallActionBarsRegionDef = validateRegionDimensions(overallActionBarsRegionDefAttempt)
    ? addAndTrackRegion(
        'overallActionBarsRegion',
        overallActionBarsRegionDefAttempt.x,
        overallActionBarsRegionDefAttempt.y,
        overallActionBarsRegionDefAttempt.width,
        overallActionBarsRegionDefAttempt.height,
      )
    : null;
  if (overallActionBarsRegionDef) {
    initialActionItemsCountForNotification = 0;
  }
}

function notifyInitializationStatus() {
  const status = {
    hpMana: !!hpManaRegionDef,
    cooldowns: !!cooldownsRegionDef,
    statusBar: !!statusBarRegionDef,
    minimap: !!minimapRegionDef,
    battleList: !!battleListRegionDef,
    partyList: !!partyListRegionDef,
    actionBars: !!overallActionBarsRegionDef,
    itemsLocated: initialActionItemsCountForNotification,
    amuletSlot: !!amuletSlotRegionDef,
    ringSlot: !!ringSlotRegionDef,
    bootsSlot: !!bootsSlotRegionDef,
    onlineMarker: !!onlineMarkerRegionDef,
    chatOff: !!chatOffRegionDef, // {{change 4: Include chatOff status}}
  };
  let body =
    `HP:${status.hpMana ? '✅' : '❌'} CD:${status.cooldowns ? '✅' : '❌'} Status:${status.statusBar ? '✅' : '❌'} Map:${status.minimap ? '✅' : '❌'}  ` +
    `Equip:[Am:${status.amuletSlot ? '✅' : '❌'} Rg:${status.ringSlot ? '✅' : '❌'} Bt:${status.bootsSlot ? '✅' : '❌'}]  ` +
    `UI:[On:${status.onlineMarker ? '✅' : '❌'} Ch:${status.chatOff ? '✅' : '❌'}]  ` +
    `Battle:${status.battleList ? '✅' : '❌'} Party:${status.partyList ? '✅' : '❌'} Actions:${status.actionBars ? '✅' : '❌'}`;
  parentPort.postMessage({ notification: { title: 'Monitor Status', body: body } });
}

function handleMinimapChange() {
  const minimapRegionEntry = currentRegionDataMap?.minimapRegion;
  if (!minimapRegionEntry?.data || !minimapRegionDef || minimapRegionEntry.data.length < 8) {
    if (minimapChanged) minimapChanged = false;
    if (lastMinimapChangeTime) lastMinimapChangeTime = null;
    if (lastMinimapData) lastMinimapData = null;
    return;
  }
  const currentMinimapRgbData = minimapRegionEntry.data.subarray(8);
  if (lastMinimapData) {
    const minimapIsDifferent = Buffer.compare(currentMinimapRgbData, lastMinimapData) !== 0;
    if (minimapIsDifferent) {
      minimapChanged = true;
      lastMinimapChangeTime = Date.now();
    } else if (minimapChanged && lastMinimapChangeTime && Date.now() - lastMinimapChangeTime > MINIMAP_CHANGE_INTERVAL) {
      minimapChanged = false;
      lastMinimapChangeTime = null;
    }
  } else {
    minimapChanged = false;
    lastMinimapChangeTime = null;
  }
  lastMinimapData = Buffer.from(currentMinimapRgbData);
}

function processDynamicRegions(regionDataMap) {
  const results = { cooldowns: {}, statusBar: {}, actionItems: {}, equipped: {}, isLoggedIn: false, isChatOff: false };
  if (!regionDataMap || typeof findSequencesNative !== 'function') {
    return results;
  }
  const getRegionBufferWithHeader = (regionName) => {
    const entry = regionDataMap[regionName];
    if (!entry?.data || entry.width === undefined || entry.height === undefined) {
      return null;
    }
    const expectedSize = entry.width * entry.height * 3 + 8;
    if (entry.data.length < expectedSize) {
      return null;
    }
    return entry.data;
  };

  const cooldownsBuffer = getRegionBufferWithHeader('cooldownsRegion');
  if (cooldownsRegionDef && cooldownsBuffer) {
    try {
      results.cooldowns = findSequencesNative(cooldownsBuffer, cooldownColorSequences, null, 'first') || {};
    } catch (e) {
      results.cooldowns = {};
    }
  }

  const statusBarBuffer = getRegionBufferWithHeader('statusBarRegion');
  if (statusBarRegionDef && statusBarBuffer) {
    try {
      results.statusBar = findSequencesNative(statusBarBuffer, statusBarSequences, null, 'first') || {};
    } catch (e) {
      results.statusBar = {};
    }
  }

  const overallActionBarsBuffer = getRegionBufferWithHeader('overallActionBarsRegion');
  if (overallActionBarsRegionDef && overallActionBarsBuffer) {
    try {
      const rawFoundItemsMap = findSequencesNative(overallActionBarsBuffer, actionBarItems, null, 'first') || {};
      const filteredActionItems = {};
      for (const itemName in rawFoundItemsMap) {
        if (rawFoundItemsMap[itemName] !== null && rawFoundItemsMap[itemName] !== undefined) {
          filteredActionItems[itemName] = rawFoundItemsMap[itemName];
        }
      }
      results.actionItems = filteredActionItems;
    } catch (e) {
      results.actionItems = {};
    }
  }

  const amuletSlotBuffer = getRegionBufferWithHeader('amuletSlotRegion');
  if (amuletSlotRegionDef && amuletSlotBuffer) {
    try {
      const foundItems = findSequencesNative(amuletSlotBuffer, equippedItems, null, 'first');
      let detectedItemName = Object.keys(foundItems).find((key) => foundItems[key] !== null);

      // If "emptyAmuletSlot" is found, change it to "Empty"
      if (detectedItemName === 'emptyAmuletSlot') {
        detectedItemName = 'Empty';
      }
      // If no item (including empty slot) is detected, set to "Unknown"
      results.equipped.amulet = detectedItemName || 'Unknown';
      detectedAmulet = results.equipped.amulet;
    } catch (e) {
      results.equipped.amulet = 'Unknown'; // Set to "Unknown" on error as well
      detectedAmulet = 'Unknown';
    }
  } else {
    results.equipped.amulet = 'Unknown'; // Set to "Unknown" if buffer is not available
    detectedAmulet = 'Unknown';
  }

  const ringSlotBuffer = getRegionBufferWithHeader('ringSlotRegion');
  if (ringSlotRegionDef && ringSlotBuffer) {
    try {
      const foundItems = findSequencesNative(ringSlotBuffer, equippedItems, null, 'first');
      let detectedItemName = Object.keys(foundItems).find((key) => foundItems[key] !== null);

      // If "emptyRingSlot" is found, change it to "Empty"
      if (detectedItemName === 'emptyRingSlot') {
        detectedItemName = 'Empty';
      }
      // If no item (including empty slot) is detected, set to "Unknown"
      results.equipped.ring = detectedItemName || 'Unknown';
      detectedRing = results.equipped.ring;
    } catch (e) {
      results.equipped.ring = 'Unknown'; // Set to "Unknown" on error as well
      detectedRing = 'Unknown';
    }
  } else {
    results.equipped.ring = 'Unknown'; // Set to "Unknown" if buffer is not available
    detectedRing = 'Unknown';
  }

  const bootsSlotBuffer = getRegionBufferWithHeader('bootsSlotRegion');
  if (bootsSlotRegionDef && bootsSlotBuffer) {
    try {
      const foundItems = findSequencesNative(bootsSlotBuffer, equippedItems, null, 'first');
      let detectedItemName = Object.keys(foundItems).find((key) => foundItems[key] !== null);

      // If "emptyBootsSlot" is found, change it to "Empty"
      if (detectedItemName === 'emptyBootsSlot') {
        detectedItemName = 'Empty';
      }
      // If no item (including empty slot) is detected, set to "Unknown"
      results.equipped.boots = detectedItemName || 'Unknown';
    } catch (e) {
      results.equipped.boots = 'Unknown'; // Set to "Unknown" on error as well
    }
  } else {
    results.equipped.boots = 'Unknown'; // Set to "Unknown" if buffer is not available
  }

  const onlineMarkerBuffer = getRegionBufferWithHeader('onlineMarkerRegion');
  if (onlineMarkerRegionDef && onlineMarkerBuffer) {
    try {
      // Check if the online marker sequence is found within its region buffer
      const foundOnlineMarker = findSequencesNative(onlineMarkerBuffer, { onlineMarker: regionColorSequences.onlineMarker }, null, 'first');
      results.isLoggedIn = foundOnlineMarker?.onlineMarker !== null;
    } catch (e) {
      results.isLoggedIn = false;
    }
  } else {
    results.isLoggedIn = false;
  }

  const chatOffBuffer = getRegionBufferWithHeader('chatOffRegion');
  if (chatOffRegionDef && chatOffBuffer) {
    try {
      // Check if the chat off sequence is found within its region buffer
      const foundChatOff = findSequencesNative(chatOffBuffer, { chatOff: regionColorSequences.chatOff }, null, 'first');
      results.isChatOff = foundChatOff?.chatOff !== null;
    } catch (e) {
      results.isChatOff = false;
    }
  } else {
    results.isChatOff = false;
  }

  return results;
}

function processCapturedData(regionDataMap, dynamicRegionResults) {
  if (minimapRegionDef) {
    handleMinimapChange();
  }
  return dynamicRegionResults;
}

function calculateHealthAndMana() {
  const hpManaEntry = currentRegionDataMap?.hpManaRegion;

  if (hpManaEntry?.data && hpManaEntry.data.length >= 8 && hpbarRelative && mpbarRelative) {
    const health = calculatePercentages(hpManaEntry.data, hpbarRelative, resourceBars.healthBar);
    const mana = calculatePercentages(hpManaEntry.data, mpbarRelative, resourceBars.manaBar);

    lastKnownGoodHealthPercentage = health;
    lastKnownGoodManaPercentage = mana;

    return { newHealthPercentage: health, newManaPercentage: mana };
  } else {
    return {
      newHealthPercentage: lastKnownGoodHealthPercentage,
      newManaPercentage: lastKnownGoodManaPercentage,
    };
  }
}

function getCharacterStatus(dynamicResults) {
  const status = {};
  const currentStatusBarRegions = dynamicResults?.statusBar || {};
  Object.keys(statusBarSequences).forEach((key) => {
    status[key] = currentStatusBarRegions[key]?.x !== undefined;
  });
  return status;
}

function getBattleListEntries() {
  const battleListEntry = currentRegionDataMap?.battleListRegion;
  if (!battleListRegionDef || !battleListEntry?.data || battleListEntry.data.length < 8) {
    return [];
  }
  if (typeof findSequencesNative !== 'function') {
    return [];
  }
  try {
    const entries = findAllOccurrences(findSequencesNative, battleListEntry.data, battleListSequences.battleEntry, null);
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    return [];
  }
}

function calculatePartyHp(partyListBufferWithHeader, barRegionRelativeToPartyListBuffer) {
  if (!partyListBufferWithHeader || partyListBufferWithHeader.length < 8 || !validateRegionDimensions(barRegionRelativeToPartyListBuffer)) {
    return -1;
  }
  try {
    const partyListBufferWidth = partyListBufferWithHeader.readUInt32LE(0);
    const relativeBarStartX = barRegionRelativeToPartyListBuffer.x;
    const relativeBarStartY = barRegionRelativeToPartyListBuffer.y;
    const barPixelWidth = barRegionRelativeToPartyListBuffer.width;
    const bytesPerPixel = 3;
    const headerSize = 8;
    const barStartIndexBytesInPartialBuffer = headerSize + (relativeBarStartY * partyListBufferWidth + relativeBarStartX) * bytesPerPixel;
    const expectedEndIndexBytes = barStartIndexBytesInPartialBuffer + barPixelWidth * bytesPerPixel;
    if (barStartIndexBytesInPartialBuffer < headerSize || expectedEndIndexBytes > partyListBufferWithHeader.length) {
      return -1;
    }
    return calculatePartyHpPercentage(
      partyListBufferWithHeader,
      resourceBars.partyEntryHpBar,
      barStartIndexBytesInPartialBuffer,
      barPixelWidth,
    );
  } catch (error) {
    return -1;
  }
}

function checkPartyMemberStatus(partyListBufferWithHeader, nameRegionRelativeToPartialBuffer) {
  if (!partyListBufferWithHeader || partyListBufferWithHeader.length < 8 || !validateRegionDimensions(nameRegionRelativeToPartialBuffer)) {
    return false;
  }
  if (typeof findSequencesNative !== 'function') {
    return false;
  }
  try {
    const statusResult = findSequencesNative(partyListBufferWithHeader, PARTY_MEMBER_STATUS, nameRegionRelativeToPartialBuffer, 'first');
    return statusResult && Object.values(statusResult).some((coords) => coords !== null);
  } catch (error) {
    return false;
  }
}

function getPartyData() {
  const partyListEntry = currentRegionDataMap?.partyListRegion;
  if (!validateRegionDimensions(partyListRegionDef) || !partyListEntry?.data || partyListEntry.data.length < 8) {
    return [];
  }
  const partyData = [];
  const approxEntryHeight = 26;
  const partyListBufferHeight = partyListEntry.height;
  const maxEntries = partyListBufferHeight > 0 ? Math.floor(partyListBufferHeight / approxEntryHeight) : 0;
  if (maxEntries <= 0) {
    return [];
  }
  const partyEntryRegionsRelativeToPartialBuffer = calculatePartyEntryRegions({ x: 0, y: 0 }, maxEntries);
  for (let i = 0; i < partyEntryRegionsRelativeToPartialBuffer.length; i++) {
    const entry = partyEntryRegionsRelativeToPartialBuffer[i];
    if (validateRegionDimensions(entry.bar) && validateRegionDimensions(entry.name)) {
      const hppc = calculatePartyHp(partyListEntry.data, entry.bar);
      const isActive = checkPartyMemberStatus(partyListEntry.data, entry.name);
      // Only add if HP could be calculated (region detected)
      if (hppc >= 0) {
        partyData.push({ id: i, hppc, uhCoordinates: entry.uhCoordinates, isActive });
      }
    }
  }
  return partyData;
}

function runRules(ruleInput) {
  if (LOG_RULE_INPUT) console.log(ruleInput);

  const currentPreset = state?.rules?.presets?.[state?.rules?.activePresetIndex];
  if (!currentPreset) {
    return;
  }
  try {
    ruleProcessorInstance.processRules(currentPreset, ruleInput, state.global);
  } catch (error) {
    console.error('Rule processing error:', error);
  }
}

async function mainLoopIteration() {
  const loopStartTime = Date.now();
  try {
    if ((!initialized && state?.global?.windowId) || shouldRestart) {
      await initializeRegions();
      if (!initialized) {
        resetRegions();
        return;
      }
    }

    if (initialized && monitoredRegionNames.length > 0) {
      const newRegionDataMap = {};

      // Capture regions
      for (const regionName of monitoredRegionNames) {
        const regionBufferInfo = regionBuffers.get(regionName);
        if (regionBufferInfo) {
          const regionResult = captureInstance.getRegionRgbData(regionName, regionBufferInfo.buffer);

          if (regionResult?.success && regionResult.width > 0 && regionResult.height > 0) {
            const expectedSize = regionResult.width * regionResult.height * 3 + 8;
            if (regionBufferInfo.buffer.length >= expectedSize) {
              // Current capture successful, update map with this new good data
              newRegionDataMap[regionName] = {
                data: regionBufferInfo.buffer, // This buffer now holds the *new* good data
                width: regionResult.width,
                height: regionResult.height,
                captureTimestampUs: regionResult.captureTimestampUs,
              };
              // Also update regionBufferInfo's internal state to reflect the latest good capture
              // This ensures regionBufferInfo itself always holds the metadata for the data it contains
              regionBufferInfo.width = regionResult.width;
              regionBufferInfo.height = regionResult.height;
              regionBufferInfo.timestamp = regionResult.captureTimestampUs;
            } else {
              // C++ addon reported success, but our buffer is too small for reported dimensions.
              // This implies data might be truncated or invalid. Fallback to last valid data.
              if (regionBufferInfo.width > 0 && regionBufferInfo.height > 0 && regionBufferInfo.timestamp > 0) {
                newRegionDataMap[regionName] = {
                  data: regionBufferInfo.buffer, // Still holds older data if no new data was written fully
                  width: regionBufferInfo.width,
                  height: regionBufferInfo.height,
                  captureTimestampUs: regionBufferInfo.timestamp,
                };
              } else {
                newRegionDataMap[regionName] = null; // No good data ever obtained for this buffer
              }
            }
          } else {
            // Current capture failed (regionResult.success is false or dimensions invalid).
            // The regionBufferInfo.buffer still holds the data from the *last successful* copy.
            if (regionBufferInfo.width > 0 && regionBufferInfo.height > 0 && regionBufferInfo.timestamp > 0) {
              newRegionDataMap[regionName] = {
                data: regionBufferInfo.buffer, // Use the buffer that already has last good data
                width: regionBufferInfo.width,
                height: regionBufferInfo.height,
                captureTimestampUs: regionBufferInfo.timestamp, // Use the timestamp of the last good data
              };
            } else {
              newRegionDataMap[regionName] = null; // No good data available
            }
          }
        } else {
          newRegionDataMap[regionName] = null;
          // This is a critical error (region config missing), log unconditionally for now.
          console.error(
            `[Worker] regionBufferInfo not found for '${regionName}' in regionBuffers map. This indicates a configuration problem.`,
          );
        }
      }
      currentRegionDataMap = newRegionDataMap; // Update the map after populating with either new or last good data

      if (shouldRestart) {
        if (captureInstance) {
          try {
            captureInstance.stopMonitorInstance();
          } catch (e) {}
        }
        return;
      }

      // Process dynamic regions and other data points
      const dynamicRegionResults = processDynamicRegions(currentRegionDataMap);
      processCapturedData(currentRegionDataMap, dynamicRegionResults);

      // Calculate/gather all data for the state update and rule input
      // This will now return last good values if current region data is bad
      const { newHealthPercentage, newManaPercentage } = calculateHealthAndMana();
      const characterStatus = getCharacterStatus(dynamicRegionResults);
      const currentCooldownRegions = dynamicRegionResults.cooldowns || {};
      const activeActionItems = dynamicRegionResults.actionItems || {};
      const equippedItemsResult = dynamicRegionResults.equipped || {};
      const battleListEntries = getBattleListEntries();
      const partyMembers = getPartyData();

      // Update CooldownManager based on current cooldown regions
      const healingCd = cooldownManager.updateCooldown('healing', currentCooldownRegions.healing?.x !== undefined);
      const supportCd = cooldownManager.updateCooldown('support', currentCooldownRegions.support?.x !== undefined);
      const attackCd = cooldownManager.updateCooldown('attack', currentCooldownRegions.attack?.x !== undefined);
      if (currentCooldownRegions.attackInactive?.x !== undefined) cooldownManager.forceDeactivate('attack');
      if (currentCooldownRegions.healingInactive?.x !== undefined) cooldownManager.forceDeactivate('healing');
      if (currentCooldownRegions.supportInactive?.x !== undefined) cooldownManager.forceDeactivate('support');

      const currentStateUpdate = {
        hppc: newHealthPercentage,
        mppc: newManaPercentage,
        healingCd,
        supportCd,
        attackCd,
        characterStatus,
        monsterNum: battleListEntries.length,
        isWalking: minimapChanged, // minimapChanged is updated in processCapturedData
        partyMembers,
        activeActionItems,
        equippedItems: {
          amulet: equippedItemsResult.amulet,
          ring: equippedItemsResult.ring,
          boots: equippedItemsResult.boots,
        },
        isLoggedIn: dynamicRegionResults.isLoggedIn,
        isChatOff: dynamicRegionResults.isChatOff,
        playerMinimapPosition: state.gameState.playerMinimapPosition, // Include player minimap position
      };

      // Dispatch the complete state update ONCE
      parentPort.postMessage({
        storeUpdate: true,
        type: 'gameState/updateGameStateFromMonitorData',
        payload: currentStateUpdate,
      });

      if (state?.global?.isBotEnabled) {
        try {
          // Pass the compiled state update object to runRules
          runRules(currentStateUpdate);
        } catch (ruleError) {
          console.error('Fatal Rule processing error:', ruleError);
          shouldRestart = true;
          initialized = false;
          if (captureInstance) {
            try {
              captureInstance.stopMonitorInstance();
            } catch (e) {}
          }
          return;
        }
      }
    } else if (initialized && monitoredRegionNames.length === 0) {
      // No regions are being monitored, which might indicate a problem or a state where monitoring is not needed.
      // The previous call to handleResizeStart was undefined and caused an error.
      // If specific resize handling is needed here in the future, it should be implemented.
    }
  } catch (err) {
    console.error('Fatal error in mainLoopIteration:', err);
    shouldRestart = true;
    initialized = false;
    if (captureInstance) {
      try {
        captureInstance.stopMonitorInstance();
      } catch (e) {}
    }
  } finally {
    const loopExecutionTime = Date.now() - loopStartTime;
    const delayTime = calculateDelayTime(loopExecutionTime, TARGET_FPS);
    if (delayTime > 0) {
      await delay(delayTime);
    }
  }
}

async function start() {
  while (true) {
    await mainLoopIteration();
  }
}

parentPort.on('message', (message) => {
  if (message && message.command === 'forceReinitialize') {
    if (captureInstance && initialized) {
      try {
        captureInstance.stopMonitorInstance();
      } catch (e) {}
    }
    initialized = false;
    shouldRestart = true;
    currentWindowId = null;
    resetRegions();
    return;
  }
  const previousWindowId = state?.global?.windowId;
  state = message; // Update the worker's internal state
  const newWindowId = state?.global?.windowId;
  if (newWindowId && newWindowId !== previousWindowId) {
    if (captureInstance && initialized) {
      try {
        captureInstance.stopMonitorInstance();
      } catch (e) {}
    }
    initialized = false;
    shouldRestart = true;
    currentWindowId = newWindowId;
    resetRegions();
    return;
  }
});

parentPort.on('close', async () => {
  if (captureInstance) {
    captureInstance.stopMonitorInstance();
  }
  resetRegions();
  process.exit(0);
});

start().catch(async (err) => {
  console.error('Worker fatal error:', err);
  if (parentPort) parentPort.postMessage({ fatalError: err.message || 'Unknown fatal error in worker' });
  if (captureInstance) {
    captureInstance.stopMonitorInstance();
  }
  resetRegions();
  process.exit(1);
});
