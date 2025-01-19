import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { calcBufferSize } from '../screenMonitor/screenGrabUtils/calcBufferSize.js';
import { captureImage } from '../screenMonitor/screenGrabUtils/captureImage.js';
import { findSequences } from '../screenMonitor/screenGrabUtils/findSequences.js';
import { regionColorSequences, resourceBars, cooldownColorSequences, statusBarSequences, battleListSequences } from '../constants/index.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import { processRules } from './screenMonitor/ruleProcessor.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';

let state;
let initialized = false;
let shouldRestart = false;
let dimensions;
let lastDimensions;
let imageBuffer;
let fullWindowImageData;
let startRegions;
let hpManaRegion, cooldownsRegion, statusBarRegion, minimapRegion, battleListRegion, partyListRegion, cooldownBarRegions, statusBarRegions;
let hpbar, mpbar;
let lastMinimapImageData;
let lastDispatchedHealthPercentage, lastDispatchedManaPercentage;
let lastMinimapChangeTime;
let minimapChanged = false;

const MINIMAP_CHANGE_INTERVAL = 128;
const LOG_EXECUTION_TIME = true;
const DIMENSION_CHECK_INTERVAL = 50;
let lastDimensionCheck = Date.now();

const require = createRequire(import.meta.url);
const windowinfo = require(workerData.windowInfoPath);
const { X11Capture } = require(workerData.x11capturePath);
const captureInstance = new X11Capture();
const cooldownManager = new CooldownManager();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checkDimensions = () => {
  const currentDimensions = windowinfo.getDimensions(state.global.windowId);
  const dimensionsChanged = currentDimensions.width !== lastDimensions?.width || currentDimensions.height !== lastDimensions?.height;

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

(async function mainLoop() {
  while (true) {
    try {
      if ((!initialized && state?.global?.windowId) || shouldRestart) {
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
        fullWindowImageData = captureImage(
          state.global.windowId,
          {
            x: 0,
            y: 0,
            width: dimensions.width,
            height: dimensions.height,
          },
          captureInstance,
        );

        startRegions = findSequences(fullWindowImageData, regionColorSequences, null, 'first', false);
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
          console.log('hpmana', hpManaRegion);
        }

        if (cooldownBar?.x !== undefined) {
          cooldownsRegion = {
            x: cooldownBar.x,
            y: cooldownBar.y,
            width: 260,
            height: 1,
          };
          console.log('cooldownbar', cooldownsRegion);
        } else if (cooldownBarFallback?.x !== undefined) {
          cooldownsRegion = {
            x: cooldownBarFallback.x,
            y: cooldownBarFallback.y,
            width: 260,
            height: 1,
          };
          console.log('cooldownbarFallback', cooldownsRegion);
        }

        if (statusBar?.x !== undefined) {
          statusBarRegion = {
            x: statusBar.x,
            y: statusBar.y,
            width: 104,
            height: 9,
          };
          console.log('statusbar', statusBarRegion);
        }

        if (minimap?.x !== undefined) {
          minimapRegion = {
            x: minimap.x,
            y: minimap.y,
            width: 106,
            height: 1,
          };
          console.log('minimap', minimapRegion);
        }

        battleListRegion = findBoundingRect(
          fullWindowImageData,
          regionColorSequences.battleListStart,
          regionColorSequences.battleListEnd,
          169,
          dimensions.height,
        );
        console.log('battleList', battleListRegion);

        partyListRegion = findBoundingRect(
          fullWindowImageData,
          regionColorSequences.partyListStart,
          regionColorSequences.partyListEnd,
          169,
          dimensions.height,
        );
        console.log('partyList', partyListRegion);

        initialized = true;
        console.log('Initialization complete.');
      }

      if (initialized) {
        // Check dimensions periodically
        if (Date.now() - lastDimensionCheck > DIMENSION_CHECK_INTERVAL) {
          lastDimensionCheck = Date.now();
          if (checkDimensions()) {
            initialized = false;
            shouldRestart = true;
            await delay(550);
            continue;
          }
        }

        const startTime = Date.now();

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

        if (partyListRegion?.x !== undefined) {
          partyEntryRegions = calculatePartyEntryRegions(partyListRegion, Math.floor(partyListRegion.height / 26));
          partyEntryRegions.forEach((entry, index) => {
            addRegionIfDefined(entry.bar, `partyEntryBar_${index}`);
            addRegionIfDefined(entry.name, `partyEntryName_${index}`);
          });
        }

        const grabResults = await Promise.all(regionsToGrab.map((region) => captureImage(state.global.windowId, region, captureInstance)));

        const capturedData = {};
        grabResults.forEach((result, index) => {
          capturedData[regionTypes[index]] = result;
        });

        // Process HP/Mana
        let newHealthPercentage = 0;
        let newManaPercentage = 0;
        if (capturedData.hpMana) {
          newHealthPercentage = calculatePercentages(hpbar, hpManaRegion, capturedData.hpMana, resourceBars.healthBar);
          newManaPercentage = calculatePercentages(mpbar, hpManaRegion, capturedData.hpMana, resourceBars.manaBar);
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
          cooldownBarRegions = findSequences(capturedData.cooldowns, cooldownColorSequences);
        } else {
          cooldownBarRegions = {
            healing: { x: undefined },
            support: { x: undefined },
            attack: { x: undefined },
          };
        }

        // Process status bar
        if (capturedData.statusBar) {
          statusBarRegions = findSequences(capturedData.statusBar, statusBarSequences);
        }

        const characterStatusUpdates = {};
        for (const [key, _] of Object.entries(statusBarSequences)) {
          characterStatusUpdates[key] = statusBarRegions?.[key]?.x !== undefined;
        }

        // Process battle list
        let battleListEntries = [];
        if (capturedData.battleList) {
          battleListEntries = findAllOccurrences(capturedData.battleList, battleListSequences.battleEntry);
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
          await processRules(
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

        const executionTime = Date.now() - startTime;
        if (LOG_EXECUTION_TIME) {
          console.log(`Loop execution time: ${executionTime} ms`);
        }
      }

      await delay(16);
    } catch (err) {
      console.error('Error in main loop:', err);
      // Optional: Add some delay before retrying after an error
      await delay(100);
    }
  }
})();
