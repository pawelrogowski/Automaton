import { parentPort } from 'worker_threads';
import { performance } from 'perf_hooks';
import { grabScreen, grabMultipleRegions } from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequences from '../screenMonitor/screenGrabUtils/findSequences.js';
import regionColorSequences from '../constants/regionColorSequeces.js';
import cooldownColorSequences from '../constants/cooldownColorSequences.js';
import battleListSequences from '../constants/battleListSequences.js';
import statusBarSequences from '../constants/statusBarSequences.js';
import getViewport from '../screenMonitor/screenGrabUtils/getViewport.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import { processRules } from './screenMonitor/ruleProcessor.js';

const COOLDOWN_DURATIONS = {
  healing: 930,
  attack: 1925,
  support: 425,
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
      // if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
      //   cooldown.active = false;
      //   console.log(`${type} CD ended after ${elapsedTime.toFixed(2)} milliseconds`);
      // }
    }

    return cooldown.active;
  }

  getCooldownState(type) {
    const cooldown = this.cooldowns[type];
    if (cooldown.active) {
      const elapsedTime = performance.now() - cooldown.startTime;
      // if (elapsedTime >= COOLDOWN_DURATIONS[type]) {
      //   cooldown.active = false;
      //   console.log(`${type} CD ended after ${elapsedTime.toFixed(2)} milliseconds`);
      // }
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
let wholeWindowData;
let hpManaImageData;
let cooldownBarImageData;
let statusBarImageData;
let battleListImageData;
let cooldownBarRegions;
let statusBarRegions;

let lastMonsterNumber;
let lastPartyNumber;
let iterationCounter = 0;
let totalExecutionTime = 0;
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
    ({ global: global } = state);
    if (global?.windowId !== null && global?.windowId !== undefined) {
      resolve(global.windowId);
      parentPort.off('message', messageHandler);
    }
  };

  parentPort.on('message', messageHandler);
});

async function main() {
  if (global.windowId) {
    const { width } = await getViewport(global.windowId);

    const imageData = await grabScreen(global.windowId);

    const startRegions = findSequences(imageData, regionColorSequences, width);
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
      width: 4,
      height: 215,
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
      width: 1000,
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
      [hpManaImageData, cooldownBarImageData, statusBarImageData, battleListImageData] =
        await grabMultipleRegions(global.windowId, [
          hpManaRegion,
          cooldownsRegion,
          statusBarRegion,
          battleListRegion,
        ]);
      screenGrabEndTime = performance.now();

      processingStartTime = performance.now();

      const { percentage: newHealthPercentage } = await calculatePercentages(
        healthBar,
        hpManaRegion,
        hpManaImageData,
        [
          [120, 61, 64],
          [211, 79, 79],
          [219, 79, 79],
          [194, 74, 74],
          [100, 46, 49],
        ],
        hpManaRegion.width,
      );

      const { percentage: newManaPercentage } = await calculatePercentages(
        manaBar,
        hpManaRegion,
        hpManaImageData,
        [
          [83, 80, 218],
          [77, 74, 194],
          [45, 45, 105],
          [61, 61, 125],
          [82, 79, 211],
        ],
        hpManaRegion.width,
      );

      cooldownBarRegions = findSequences(cooldownBarImageData, cooldownColorSequences, 1000);

      statusBarRegions = findSequences(statusBarImageData, statusBarSequences, 106);

      const characterStatusUpdates = {};
      for (const [key, value] of Object.entries(statusBarSequences)) {
        characterStatusUpdates[key] = statusBarRegions[key]?.x !== undefined;
      }

      let monsterNumber = findAllOccurrences(
        battleListImageData,
        battleListSequences.battleEntry,
        4,
      );

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
        monsterNum: monsterNumber,
      };

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

      hpManaImageData = null;
      cooldownBarImageData = null;
      statusBarImageData = null;
      setTimeout(loop, global.refreshRate);
    }

    loop();
  }
}

waitForWindowId.then(() => {
  main();
});
