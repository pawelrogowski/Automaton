import regionColorSequences from '../regionColorSequences/index.js';
import { parentPort } from 'worker_threads';
import { grabScreen } from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import findSequences from '../screenMonitor/screenGrabUtils/findSequences.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import { processRules } from './screenMonitor/ruleProcessor.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/regionColorSequences.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';

let state = null;
let global = null;
let healing = null;
let gameState = null;
let prevState;
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let cooldownBarRegions, statusBarRegions;

parentPort.on('message', (state) => {
  if (prevState !== state) {
    ({ gameState, global, healing } = state);
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

      console.log('Adjusting screen position...');
      const imageData = await grabScreen(global.windowId);
      const startRegions = findSequences(imageData, regionColorSequences.regionColorSequences);
      const { healthBar, manaBar, cooldownBar, statusBar, battleListStart, partyListStart } =
        startRegions;

      const battleListRegion = {
        x: battleListStart.x,
        y: battleListStart.y,
        width: 4,
        height: 215,
      };

      const partyListRegion = {
        x: partyListStart.x,
        y: partyListStart.y,
        width: 131,
        height: 81,
      };

      const hpManaRegion = {
        x: healthBar.x,
        y: healthBar.y,
        width: 94,
        height: 14,
      };

      const cooldownsRegion = {
        x: cooldownBar.x,
        y: cooldownBar.y,
        width: 260,
        height: 1,
      };

      const statusBarRegion = {
        x: statusBar.x,
        y: statusBar.y,
        width: 104,
        height: 9,
      };

      async function loop() {
        while (true) {
          const regionsToGrab = [
            hpManaRegion,
            cooldownsRegion,
            statusBarRegion,
            battleListRegion,
            partyListRegion,
          ];

          const partyEntryRegions = calculatePartyEntryRegions(partyListStart, 1);
          partyEntryRegions.forEach((entry) => {
            regionsToGrab.push(entry.bar);
            regionsToGrab.push(entry.name);
          });

          const grabResults = await Promise.all(
            regionsToGrab.map((region) => grabScreen(global.windowId, region)),
          );

          const [
            hpManaImageData,
            cooldownBarImageData,
            statusBarImageData,
            battleListImageData,
            partyListImageData,
            ...partyEntryImageData
          ] = grabResults;

          const newHealthPercentage = calculatePercentages(
            healthBar,
            hpManaRegion,
            hpManaImageData,
            regionColorSequences.resourceBars.healthBar,
          );

          if (newHealthPercentage === 0) {
            return;
          }

          const newManaPercentage = calculatePercentages(
            manaBar,
            hpManaRegion,
            hpManaImageData,
            regionColorSequences.resourceBars.manaBar,
          );

          cooldownBarRegions = findSequences(
            cooldownBarImageData,
            regionColorSequences.cooldownColorSequences,
          );

          statusBarRegions = findSequences(
            statusBarImageData,
            regionColorSequences.statusBarSequences,
          );

          const characterStatusUpdates = {};
          for (const [key, _] of Object.entries(regionColorSequences.statusBarSequences)) {
            characterStatusUpdates[key] = statusBarRegions[key]?.x !== undefined;
          }

          let battleListEntries = findAllOccurrences(
            battleListImageData,
            regionColorSequences.battleListSequences.battleEntry,
          );

          const partyData = [];
          for (let i = 0; i < partyEntryRegions.length; i++) {
            const barRegion = partyEntryRegions[i].bar;
            const nameRegion = partyEntryRegions[i].name;

            const barStartIndex =
              (barRegion.y - partyListRegion.y) * partyListRegion.width +
              (barRegion.x - partyListRegion.x);

            const hpPercentage = calculatePartyHpPercentage(
              partyListImageData,
              regionColorSequences.resourceBars.partyEntryHpBar,
              barStartIndex * 3,
              130,
            );

            // Check for active/inactive status
            const nameStartIndex =
              (nameRegion.y - partyListRegion.y) * partyListRegion.width +
              (nameRegion.x - partyListRegion.x);
            const nameEndIndex = nameStartIndex + nameRegion.width * nameRegion.height;

            const statusSequences = findSequences(
              partyListImageData.subarray(nameStartIndex * 3, nameEndIndex * 3),
              PARTY_MEMBER_STATUS,
              null,
              'first',
            );

            const isActive =
              Object.keys(statusSequences.active).length > 0 ||
              Object.keys(statusSequences.activeHover).length > 0;

            if (hpPercentage >= 0) {
              partyData.push({
                hpPercentage,
                uhCoordinates: partyEntryRegions[i].uhCoordinates,
                isActive,
              });
            }
          }

          directGameState = {
            hpPercentage: newHealthPercentage,
            manaPercentage: newManaPercentage,
            healingCdActive: cooldownManager.updateCooldown(
              'healing',
              cooldownBarRegions.healing?.x !== undefined,
            ),
            supportCdActive: cooldownManager.updateCooldown(
              'support',
              cooldownBarRegions.support?.x !== undefined,
            ),
            attackCdActive: cooldownManager.updateCooldown(
              'attack',
              cooldownBarRegions.attack?.x !== undefined,
            ),
            characterStatus: characterStatusUpdates,
            monsterNum: battleListEntries.length,
            partyMembers: partyData,
          };

          if (global.botEnabled) {
            await processRules(
              healing.presets[healing.activePresetIndex],
              healing,
              directGameState,
              global,
            );
          }

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

          await new Promise((resolve) => setTimeout(resolve, global.refreshRate));
        }
      }

      await loop();
    } catch (error) {
      console.log(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

waitForWindowId.then(() => {
  main();
});
