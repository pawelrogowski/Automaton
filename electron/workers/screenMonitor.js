import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { performance } from 'perf_hooks'; // Use performance module
import { calcBufferSize } from '../screenMonitor/screenGrabUtils/calcBufferSize.js';
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
import { keyPress } from '../keyboardControll/keyPress.js';

let state;
let initialized = false;
let shouldRestart = false;
let dimensions;
let lastDimensions = null;
let imageBuffer;
let fullWindowImageData;
let startRegions;
let hpManaRegion,
  cooldownsRegion,
  statusBarRegion,
  minimapRegion,
  battleListRegion,
  partyListRegion,
  cooldownBarRegions,
  statusBarRegions,
  foundActionItems,
  actionBarsRegion;

let hpbar, mpbar;
let lastMinimapImageData;
let lastDispatchedHealthPercentage, lastDispatchedManaPercentage;
let lastMinimapChangeTime;
let minimapChanged = false;
let error = '';
const MINIMAP_CHANGE_INTERVAL = 128;
const LOG_EXECUTION_TIME = false;
const DIMENSION_CHECK_INTERVAL = 32;
let lastDimensionCheck = Date.now();

const require = createRequire(import.meta.url);
const windowinfo = require(workerData.windowInfoPath);
const { X11Capture } = require(workerData.x11capturePath);
const captureInstance = new X11Capture();
const cooldownManager = new CooldownManager();

const ruleProcessorInstance = new RuleProcessor();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checkDimensions = () => {
  if (!state?.global?.windowId) return false;

  const currentDimensions = windowinfo.getDimensions(state.global.windowId);

  // If this is the first check (lastDimensions is null), just store the dimensions
  if (lastDimensions === null) {
    lastDimensions = currentDimensions;
    dimensions = currentDimensions;
    return false;
  }

  // Only check for changes if we have previous dimensions
  const dimensionsChanged = currentDimensions.width !== lastDimensions.width || currentDimensions.height !== lastDimensions.height;

  if (dimensionsChanged) {
    console.log('Window dimensions changed. Restarting initialization...');
    dimensions = currentDimensions;
    lastDimensions = currentDimensions;
    return true;
  }

  return false;
};

parentPort.on('message', (updatedState) => {
  state = updatedState;
});

// Function to calculate statistics
const calculateStatistics = (values) => {
  if (values.length === 0) return { average: 0, median: 0, highest: 0, lowest: 0 };

  const sortedValues = [...values].sort((a, b) => a - b);
  const sum = sortedValues.reduce((acc, val) => acc + val, 0);
  const average = sum / sortedValues.length;
  const median = sortedValues[Math.floor(sortedValues.length / 2)];
  const highest = sortedValues[sortedValues.length - 1];
  const lowest = sortedValues[0];

  return { average, median, highest, lowest };
};

(async function mainLoop() {
  const executionStats = {}; // Object to store statistics for each metric
  let iterationCount = 0; // Track the number of iterations

  while (true) {
    const executionTimes = {}; // Object to store execution times for this loop
    iterationCount++;

    try {
      if ((!initialized && state?.global?.windowId) || shouldRestart) {
        performance.mark('initialization-start');
        hpManaRegion = null;
        cooldownsRegion = null;
        statusBarRegion = null;
        minimapRegion = null;
        battleListRegion = null;
        partyListRegion = null;
        cooldownBarRegions = null;
        statusBarRegions = null;
        shouldRestart = false;
        // Perform one-time initialization
        dimensions = windowinfo.getDimensions(state.global.windowId);
        if (lastDimensions === null) {
          lastDimensions = dimensions;
        }
        fullWindowImageData = await captureImage(
          state.global.windowId,
          {
            x: 0,
            y: 0,
            width: dimensions.width,
            height: dimensions.height,
          },
          captureInstance,
        );

        performance.mark('findSequences-start');
        startRegions = findSequences(fullWindowImageData, regionColorSequences, null, 'first', false);
        performance.mark('findSequences-end');
        executionTimes['findSequences'] = performance.measure('findSequences', 'findSequences-start', 'findSequences-end').duration;

        const { healthBar, manaBar, cooldownBar, cooldownBarFallback, statusBar, minimap } = startRegions;
        hpbar = healthBar;
        mpbar = manaBar;
        if (healthBar?.x !== undefined) {
          hpManaRegion = {
            x: healthBar.x,
            y: healthBar.y,
            width: 94,
            height: 14,
          };
        }

        if (cooldownBar?.x !== undefined) {
          cooldownsRegion = {
            x: cooldownBar.x,
            y: cooldownBar.y,
            width: 260,
            height: 1,
          };
        } else if (cooldownBarFallback?.x !== undefined) {
          cooldownsRegion = {
            x: cooldownBarFallback.x,
            y: cooldownBarFallback.y,
            width: 260,
            height: 1,
          };
        }

        if (statusBar?.x !== undefined) {
          statusBarRegion = {
            x: statusBar.x,
            y: statusBar.y,
            width: 104,
            height: 9,
          };
        }

        if (minimap?.x !== undefined) {
          minimapRegion = {
            x: minimap.x,
            y: minimap.y,
            width: 106,
            height: 1,
          };
        }

        performance.mark('findBoundingRect-start');
        battleListRegion = findBoundingRect(
          fullWindowImageData,
          regionColorSequences.battleListStart,
          regionColorSequences.battleListEnd,
          169,
          dimensions.height,
        );

        partyListRegion = findBoundingRect(
          fullWindowImageData,
          regionColorSequences.partyListStart,
          regionColorSequences.partyListEnd,
          169,
          dimensions.height,
        );
        console.time('findActionBars');
        actionBarsRegion = findBoundingRect(
          fullWindowImageData,
          regionColorSequences.hotkeyBarBottomStart,
          regionColorSequences.hotkeyBarBottomEnd,
          dimensions.width,
          dimensions.height,
        );
        console.timeEnd('findActionBars');
        console.log(actionBarsRegion);
        performance.mark('findBoundingRect-end');
        executionTimes['findBoundingRect'] = performance.measure(
          'findBoundingRect',
          'findBoundingRect-start',
          'findBoundingRect-end',
        ).duration;

        initialized = true;
        performance.mark('initialization-end');
        executionTimes['initialization'] = performance.measure('initialization', 'initialization-start', 'initialization-end').duration;
      }

      if (initialized) {
        // Check dimensions periodically
        if (Date.now() - lastDimensionCheck > DIMENSION_CHECK_INTERVAL) {
          lastDimensionCheck = Date.now();
          if (checkDimensions()) {
            initialized = false;
            shouldRestart = true;
            await delay(50);
            continue;
          }
        }

        const startTime = performance.now();

        const regionsToGrab = [];
        const regionTypes = [];
        let partyEntryRegions = [];

        const addRegionIfDefined = (region, type) => {
          if (region?.x !== undefined) {
            regionsToGrab.push(region);
            regionTypes.push(type);
          } else {
            console.log(`${type} region not found`);
          }
        };

        addRegionIfDefined(hpManaRegion, 'hpMana');
        addRegionIfDefined(cooldownsRegion, 'cooldowns');
        addRegionIfDefined(statusBarRegion, 'statusBar');
        addRegionIfDefined(battleListRegion, 'battleList');
        addRegionIfDefined(partyListRegion, 'partyList');
        addRegionIfDefined(minimapRegion, 'minimap');
        addRegionIfDefined(actionBarsRegion, 'actionBars');

        if (partyListRegion?.x !== undefined) {
          partyEntryRegions = calculatePartyEntryRegions(partyListRegion, Math.floor(partyListRegion.height / 26));
          partyEntryRegions.forEach((entry, index) => {
            addRegionIfDefined(entry.bar, `partyEntryBar_${index}`);
            addRegionIfDefined(entry.name, `partyEntryName_${index}`);
          });
        }

        performance.mark('captureImage-start');
        const grabResults = await Promise.all(
          regionsToGrab.map(async (region) => await captureImage(state.global.windowId, region, captureInstance)),
        );
        performance.mark('captureImage-end');
        executionTimes['captureImage'] = performance.measure('captureImage', 'captureImage-start', 'captureImage-end').duration;

        const capturedData = {};
        grabResults.forEach((result, index) => {
          capturedData[regionTypes[index]] = result;
        });

        // Process HP/Mana
        let newHealthPercentage = 0;
        let newManaPercentage = 0;
        if (capturedData.hpMana) {
          performance.mark('calculatePercentages-start');
          newHealthPercentage = calculatePercentages(hpbar, hpManaRegion, capturedData.hpMana, resourceBars.healthBar);
          newManaPercentage = calculatePercentages(mpbar, hpManaRegion, capturedData.hpMana, resourceBars.manaBar);
          performance.mark('calculatePercentages-end');
          executionTimes['calculatePercentages'] = performance.measure(
            'calculatePercentages',
            'calculatePercentages-start',
            'calculatePercentages-end',
          ).duration;
        }

        if (newHealthPercentage === 0) {
          shouldRestart = true;
        }

        // Process minimap changes
        if (capturedData.minimap) {
          if (lastMinimapImageData) {
            const minimapIsDifferent = Buffer.compare(capturedData.minimap, lastMinimapImageData) !== 0;
            if (minimapIsDifferent) {
              minimapChanged = true;
              lastMinimapChangeTime = Date.now();
            } else if (lastMinimapChangeTime && Date.now() - lastMinimapChangeTime > MINIMAP_CHANGE_INTERVAL) {
              minimapChanged = false;
            }
          }
          lastMinimapImageData = capturedData.minimap;
        }

        // Process cooldowns
        if (capturedData.cooldowns) {
          performance.mark('findSequencesCooldowns-start');
          cooldownBarRegions = findSequences(capturedData.cooldowns, cooldownColorSequences);
          performance.mark('findSequencesCooldowns-end');
          executionTimes['findSequencesCooldowns'] = performance.measure(
            'findSequencesCooldowns',
            'findSequencesCooldowns-start',
            'findSequencesCooldowns-end',
          ).duration;
        } else {
          cooldownBarRegions = {
            healing: { x: undefined },
            support: { x: undefined },
            attack: { x: undefined },
          };
        }

        // Process status bar
        if (capturedData.statusBar) {
          performance.mark('findSequencesStatusBar-start');
          statusBarRegions = findSequences(capturedData.statusBar, statusBarSequences);
          performance.mark('findSequencesStatusBar-end');
          executionTimes['findSequencesStatusBar'] = performance.measure(
            'findSequencesStatusBar',
            'findSequencesStatusBar-start',
            'findSequencesStatusBar-end',
          ).duration;
        }

        const characterStatusUpdates = {};
        for (const [key, _] of Object.entries(statusBarSequences)) {
          characterStatusUpdates[key] = statusBarRegions?.[key]?.x !== undefined;
        }

        // Process action bar items
        if (capturedData.actionBars) {
          foundActionItems = findSequences(capturedData.actionBars, actionBarItems);

          console.log(foundActionItems);
          // if (foundActionItems.exura?.x !== undefined && newHealthPercentage < 100) {
          //   keyPress(state.global.windowId, ['p']);
          // }
        }

        // Process battle list
        let battleListEntries = [];
        if (capturedData.battleList) {
          performance.mark('findAllOccurrences-start');
          battleListEntries = findAllOccurrences(capturedData.battleList, battleListSequences.battleEntry);
          performance.mark('findAllOccurrences-end');
          executionTimes['findAllOccurrences'] = performance.measure(
            'findAllOccurrences',
            'findAllOccurrences-start',
            'findAllOccurrences-end',
          ).duration;
        }

        // Process party data
        const partyData = [];
        if (capturedData.partyList) {
          for (let i = 0; i < partyEntryRegions.length; i++) {
            const barRegion = partyEntryRegions[i].bar;
            const nameRegion = partyEntryRegions[i].name;

            // Calculate HP percentage using direct offset in the main party list image
            const barStartIndex = (barRegion.y - partyListRegion.y) * partyListRegion.width + (barRegion.x - partyListRegion.x);
            const hpPercentage = calculatePartyHpPercentage(capturedData.partyList, resourceBars.partyEntryHpBar, barStartIndex * 3, 130);

            // Create proper buffer for name status checking
            const nameStartIndex = (nameRegion.y - partyListRegion.y) * partyListRegion.width + (nameRegion.x - partyListRegion.x);
            const nameEndIndex = nameStartIndex + nameRegion.width * nameRegion.height;

            const nameBuffer = capturedData.partyList.subarray(nameStartIndex * 3, nameEndIndex * 3);

            const partyMemberStatusSequences = findSequences(nameBuffer, PARTY_MEMBER_STATUS, null, 'first', true);

            const isActive =
              Object.keys(partyMemberStatusSequences.active || {}).length > 0 ||
              Object.keys(partyMemberStatusSequences.activeHover || {}).length > 0;

            if (hpPercentage >= 0) {
              partyData.push({
                hpPercentage,
                uhCoordinates: partyEntryRegions[i].uhCoordinates,
                isActive,
              });
            }
          }
        }

        // Process rules if bot is enabled
        if (state.global.botEnabled) {
          performance.mark('processRules-start');
          ruleProcessorInstance.processRules(
            state.healing.presets[state.healing.activePresetIndex],
            {
              hpPercentage: newHealthPercentage,
              manaPercentage: newManaPercentage,
              healingCdActive: cooldownManager.updateCooldown('healing', cooldownBarRegions.healing?.x !== undefined),
              supportCdActive: cooldownManager.updateCooldown('support', cooldownBarRegions.support?.x !== undefined),
              attackCdActive: cooldownManager.updateCooldown('attack', cooldownBarRegions.attack?.x !== undefined),
              characterStatus: characterStatusUpdates,
              monsterNum: battleListEntries.length,
              isWalking: minimapChanged,
              partyMembers: partyData,
            },
            state.global,
          );
          performance.mark('processRules-end');
          executionTimes['processRules'] = performance.measure('processRules', 'processRules-start', 'processRules-end').duration;
        }

        // Update store with new percentages
        if (newHealthPercentage !== lastDispatchedHealthPercentage) {
          parentPort.postMessage({
            storeUpdate: true,
            type: 'setHealthPercent',
            payload: { hpPercentage: newHealthPercentage },
          });
          lastDispatchedHealthPercentage = newHealthPercentage;
        }

        if (newManaPercentage !== lastDispatchedManaPercentage) {
          parentPort.postMessage({
            storeUpdate: true,
            type: 'setManaPercent',
            payload: { manaPercentage: newManaPercentage },
          });
          lastDispatchedManaPercentage = newManaPercentage;
        }

        const executionTime = performance.now() - startTime;
        executionTimes['totalLoop'] = executionTime;

        // Update statistics for each metric
        for (const [key, value] of Object.entries(executionTimes)) {
          if (!executionStats[key]) {
            executionStats[key] = [];
          }
          executionStats[key].push(value);
        }

        if (LOG_EXECUTION_TIME) {
          console.clear(); // Clear the terminal

          // Calculate and log statistics
          const statsTable = {};
          for (const [key, values] of Object.entries(executionStats)) {
            const { average, median, highest, lowest } = calculateStatistics(values);
            statsTable[key] = {
              average: average.toFixed(2),
              median: median.toFixed(2),
              highest: highest.toFixed(2),
              lowest: lowest.toFixed(2),
            };
          }
          s;
          console.table(statsTable);
          console.log(`Iteration Count: ${iterationCount}`);
        }
      }
      await delay(32);
    } catch (err) {
      console.error('Error in main loop:', err);
    }
  }
})();
