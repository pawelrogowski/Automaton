//new script
import { regionColorSequences, resourceBars, cooldownColorSequences, statusBarSequences, battleListSequences } from '../constants/index.js';
import { parentPort, workerData } from 'worker_threads';
globalThis.grabImagePath = workerData.grabImagePath;

import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import { findSequences } from '../screenMonitor/screenGrabUtils/findSequences.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import { processRules } from './screenMonitor/ruleProcessor.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import { createRequire } from 'module';
import { captureImage } from '../screenMonitor/screenGrabUtils/captureImage.js';
import { calcBufferSize } from '../screenMonitor/screenGrabUtils/calcBufferSize.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';

const require = createRequire(import.meta.url);
const { X11Capture } = require(workerData.x11capturePath);
const windowinfo = require(workerData.windowInfoPath);

// 4k resolution rgb data + 8bit header for width and height
let maxWidth = 3840;
let maxHeight = 2160;
let bufferSize = maxWidth * maxHeight * 3 + 8;
let imageBuffer = Buffer.allocUnsafe(bufferSize);

let state = null;
let global = null;
let healing = null;

let prevState;
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let cooldownBarRegions;
let statusBarRegions;
let minimapChanged = false;
let lastMinimapImageData = null;
let lastMinimapChangeTime = null;
let numWindowId;
const CHANGE_DURATION = 128; // used for minimap changes

const captureInstance = new X11Capture();

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ global, healing } = state);
    numWindowId = Number(global.windowId);
  }
  prevState = state;
});

const waitForWindowId = new Promise((resolve) => {
  const messageHandler = (updatedState) => {
    state = updatedState;
    ({ global } = state);
    if (global?.windowId !== null && global?.windowId !== undefined) {
      resolve(global.windowId);
      parentPort.off('message', messageHandler);
    }
  };

  parentPort.on('message', messageHandler);
});

const cooldownManager = new CooldownManager();

async function main() {
  while (true) {
    try {
      if (!global.windowId) {
        console.log('Waiting for window...');
        await waitForWindowId;
      }

      const dimensions = windowinfo.getDimensions(numWindowId);
      console.log(`Scanning Window: ${windowinfo.getName(numWindowId)}(${numWindowId})\n${JSON.stringify(dimensions)}`);
      imageBuffer = Buffer.allocUnsafe(calcBufferSize(dimensions.width, dimensions.height, 8));

      console.time('FindAllSequencesInBinaryData');
      const imageData = captureImage(
        numWindowId,
        {
          x: 0,
          y: 0,
          width: dimensions.width,
          height: dimensions.height,
        },
        captureInstance,
      );
      console.log(imageData);

      const startRegions = findSequences(imageData, regionColorSequences);
      console.timeEnd('FindAllSequencesInBinaryData');
      console.log('Refresh Rate set at:', Math.floor(1000 / global.refreshRate), 'FPS');
      const { healthBar, manaBar, cooldownBar, cooldownBarFallback, statusBar, minimap } = startRegions;

      // Define regions only if they were found
      let hpManaRegion;
      if (healthBar?.x !== undefined) {
        hpManaRegion = {
          x: healthBar.x,
          y: healthBar.y,
          width: 94,
          height: 14,
        };
        console.log('hpmana', hpManaRegion);
      }

      let cooldownsRegion;
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

      let statusBarRegion;
      if (statusBar?.x !== undefined) {
        statusBarRegion = {
          x: statusBar.x,
          y: statusBar.y,
          width: 104,
          height: 9,
        };
        console.log('statusbar', statusBarRegion);
      }

      let minimapRegion;
      if (minimap?.x !== undefined) {
        minimapRegion = {
          x: minimap.x,
          y: minimap.y,
          width: 106,
          height: 1,
        };
        console.log('minimap', minimapRegion);
      }

      const battleListRegion = findBoundingRect(
        imageData,
        regionColorSequences.battleListStart,
        regionColorSequences.battleListEnd,
        169,
        dimensions.height,
      );
      console.log('battleList', battleListRegion);

      const partyListRegion = findBoundingRect(
        imageData,
        regionColorSequences.partyListStart,
        regionColorSequences.partyListEnd,
        169,
        dimensions.height,
      );
      console.log('partyList', partyListRegion);

      async function loop() {
        let lastLoopStartTime = Date.now();

        while (true) {
          const LOOP_INTERVAL = global.refreshRate;
          const loopStartTime = Date.now();

          // Prepare regions to grab, only including defined regions
          const regionsToGrab = [];
          const regionTypes = []; // Keep track of what each region is

          // Helper function to safely add regions
          const addRegionIfDefined = (region, type) => {
            if (region?.x !== undefined) {
              regionsToGrab.push(region);
              regionTypes.push(type);
            } else {
              console.log(`${type} region not found`);
            }
          };

          // Add each region only if it's defined
          addRegionIfDefined(hpManaRegion, 'hpMana');
          addRegionIfDefined(cooldownsRegion, 'cooldowns');
          addRegionIfDefined(statusBarRegion, 'statusBar');
          addRegionIfDefined(battleListRegion, 'battleList');
          addRegionIfDefined(partyListRegion, 'partyList');
          addRegionIfDefined(minimapRegion, 'minimap');

          // Only add party entry regions if party list region exists
          let partyEntryRegions = [];
          if (partyListRegion?.x !== undefined) {
            partyEntryRegions = calculatePartyEntryRegions(partyListRegion, Math.floor(partyListRegion.height / 26));
            partyEntryRegions.forEach((entry, index) => {
              addRegionIfDefined(entry.bar, `partyEntryBar_${index}`);
              addRegionIfDefined(entry.name, `partyEntryName_${index}`);
            });
          }

          // Grab images only for regions that exist
          const grabResults = await Promise.all(regionsToGrab.map((region) => captureImage(numWindowId, region, captureInstance)));

          // Map results to their corresponding types
          const capturedData = {};
          grabResults.forEach((result, index) => {
            capturedData[regionTypes[index]] = result;
          });

          // Process HP/Mana
          let newHealthPercentage = 0;
          let newManaPercentage = 0;
          if (capturedData.hpMana) {
            newHealthPercentage = calculatePercentages(healthBar, hpManaRegion, capturedData.hpMana, resourceBars.healthBar);
            newManaPercentage = calculatePercentages(manaBar, hpManaRegion, capturedData.hpMana, resourceBars.manaBar);
          }

          // Process minimap changes
          if (capturedData.minimap) {
            if (lastMinimapImageData) {
              const minimapIsDifferent = Buffer.compare(capturedData.minimap, lastMinimapImageData) !== 0;
              if (minimapIsDifferent) {
                minimapChanged = true;
                lastMinimapChangeTime = Date.now();
              } else if (lastMinimapChangeTime && Date.now() - lastMinimapChangeTime > CHANGE_DURATION) {
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
          if (global.botEnabled) {
            await processRules(
              healing.presets[healing.activePresetIndex],
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
              global,
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

          // Calculate and apply delay for consistent interval
          const processingTime = Date.now() - loopStartTime;
          const delay = Math.max(0, LOOP_INTERVAL - processingTime);
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          lastLoopStartTime = loopStartTime;
        }
      }

      await loop();
    } catch (error) {
      console.log(error);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

waitForWindowId.then(() => {
  main();
});
