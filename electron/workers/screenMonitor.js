import * as CONSTANTS from '../constants/index.js';
import { parentPort } from 'worker_threads';
import { performance } from 'perf_hooks';
import { grabScreen, grabMultipleRegions } from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import findSequences from '../screenMonitor/screenGrabUtils/findSequences.js';
import getViewport from '../screenMonitor/screenGrabUtils/getViewport.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import { processRules } from './screenMonitor/ruleProcessor.js';

const COOLDOWN_DURATIONS = {
  healing: 930,
  attack: 1925,
  support: 425,
};

const PARTY_MEMBER_STATUS = {
  active: {
    sequence: [
      [192, 192, 192],
      [192, 192, 192],
    ],
    direction: 'horizontal',
  },
  inactive: {
    sequence: [
      [128, 128, 128],
      [128, 128, 128],
    ],
    direction: 'horizontal',
  },
};

class CooldownManager {
  constructor() {
    this.cooldowns = {
      healing: { active: false, startTime: 0 },
      attack: { active: false, startTime: 0 },
      support: { active: false, startTime: 0 },
    };
  }

  updateCooldown(type, isActive) {
    const now = performance.now();
    const cooldown = this.cooldowns[type];

    if (isActive && !cooldown.active) {
      cooldown.active = true;
      cooldown.startTime = now;
    } else if (!isActive && cooldown.active) {
      const elapsedTime = now - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;
      }
    }

    return cooldown.active;
  }

  getCooldownState(type) {
    const cooldown = this.cooldowns[type];
    if (cooldown.active) {
      const elapsedTime = performance.now() - cooldown.startTime;
      if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
        cooldown.active = false;
      }
    }
    return cooldown.active;
  }
}

let state = null;
let global = null;
let healing = null;
let gameState = null;
let prevState;
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let lastDispatchedCharacterStatuses = {};
let cooldownBarRegions, statusBarRegions;
let directGameState;
let lastDirectGameState;

let screenGrabStartTime,
  screenGrabEndTime,
  processingStartTime,
  processingEndTime,
  keypressStartTime,
  keypressEndTime;
let frameCount = 0;
let lastFpsUpdate = performance.now();
let fps = 0;
let fastestIteration = Infinity;
let slowestIteration = 0;
let iterationStartTime;

const cooldownManager = new CooldownManager();

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

function calculatePartyEntryRegions(partyListStart, entryCount) {
  const regions = [];
  for (let i = 0; i < entryCount; i++) {
    regions.push({
      bar: {
        x: partyListStart.x + 1,
        y: partyListStart.y + 6 + i * 26,
        width: 130,
        height: 1,
      },
      name: {
        x: partyListStart.x + 1,
        y: partyListStart.y + i * 26,
        width: 6,
        height: 5,
      },
      uhCoordinates: {
        x: partyListStart.x + getRandomNumber(5, 100),
        y: partyListStart.y + getRandomNumber(24, 30) + i * 26,
      },
    });
  }
  return regions;
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  if (global.windowId) {
    const imageData = await grabScreen(global.windowId);
    const { width } = await getViewport(global.windowId);
    const startRegions = findSequences(imageData, CONSTANTS.regionColorSequences, width);
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
      iterationStartTime = performance.now();
      frameCount++;

      if (performance.now() - lastFpsUpdate >= 1000) {
        fps = Math.round((frameCount * 1000) / (performance.now() - lastFpsUpdate));
        frameCount = 0;
        lastFpsUpdate = performance.now();
      }

      screenGrabStartTime = performance.now();

      const partyEntryRegions = calculatePartyEntryRegions(partyListStart, 1);

      const regionsToGrab = [
        hpManaRegion,
        cooldownsRegion,
        statusBarRegion,
        battleListRegion,
        partyListRegion,
      ];

      partyEntryRegions.forEach((entry) => {
        regionsToGrab.push(entry.bar);
        regionsToGrab.push(entry.name);
      });

      const grabResults = await grabMultipleRegions(global.windowId, regionsToGrab);

      const [
        hpManaImageData,
        cooldownBarImageData,
        statusBarImageData,
        battleListImageData,
        partyListImageData,
        ...partyEntryImageData
      ] = grabResults;

      screenGrabEndTime = performance.now();

      processingStartTime = performance.now();

      const newHealthPercentage = await calculatePercentages(
        healthBar,
        hpManaRegion,
        hpManaImageData,
        CONSTANTS.resourceBars.healthBar,
        hpManaRegion.width,
      );

      const newManaPercentage = await calculatePercentages(
        manaBar,
        hpManaRegion,
        hpManaImageData,
        CONSTANTS.resourceBars.manaBar,
        hpManaRegion.width,
      );

      cooldownBarRegions = findSequences(
        cooldownBarImageData,
        CONSTANTS.cooldownColorSequences,
        240,
      );

      statusBarRegions = findSequences(statusBarImageData, CONSTANTS.statusBarSequences, 106);

      const characterStatusUpdates = {};
      for (const [key, value] of Object.entries(CONSTANTS.statusBarSequences)) {
        characterStatusUpdates[key] = statusBarRegions[key]?.x !== undefined;
      }

      let battleListEntries = findAllOccurrences(
        battleListImageData,
        CONSTANTS.battleListSequences.battleEntry,
        4,
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
          CONSTANTS.resourceBars.partyEntryHpBar,
          barStartIndex * 4,
          130,
        );

        // Check for active/inactive status
        const nameStartIndex =
          (nameRegion.y - partyListRegion.y) * partyListRegion.width +
          (nameRegion.x - partyListRegion.x);
        const nameEndIndex = nameStartIndex + nameRegion.width * nameRegion.height;

        const statusSequences = findSequences(
          partyListImageData.subarray(nameStartIndex * 4, nameEndIndex * 4),
          PARTY_MEMBER_STATUS,
          nameRegion.width,
          null,
          'first',
        );

        const isActive = Object.keys(statusSequences.active).length > 0;

        if (hpPercentage >= 0) {
          // Only add valid entries
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

      console.log(partyData);
      processingEndTime = performance.now();

      if (global.botEnabled) {
        keypressStartTime = performance.now();

        await processRules(
          healing.presets[healing.activePresetIndex],
          healing,
          directGameState,
          global,
        );
        keypressEndTime = performance.now();
      }

      const iterationEndTime = performance.now();
      const iterationDuration = iterationEndTime - iterationStartTime;

      fastestIteration = Math.min(fastestIteration, iterationDuration);
      slowestIteration = Math.max(slowestIteration, iterationDuration);

      if (newHealthPercentage !== lastDispatchedHealthPercentage) {
        parentPort.postMessage({
          type: 'setHealthPercent',
          payload: { hpPercentage: newHealthPercentage },
        });
        lastDispatchedHealthPercentage = newHealthPercentage;
      }
      if (newManaPercentage !== lastDispatchedManaPercentage) {
        parentPort.postMessage({
          type: 'setManaPercent',
          payload: { manaPercentage: newManaPercentage },
        });
        lastDispatchedManaPercentage = newManaPercentage;
      }

      setTimeout(loop, global.refreshRate);
    }

    loop();
  }
}

waitForWindowId.then(() => {
  main();
});
