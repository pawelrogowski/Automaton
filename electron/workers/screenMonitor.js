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

let state = null;
let global = null;
let healing = null;
let gameState = null;
let prevState;
let lastCooldownStates = {};
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let lastDispatchedCharacterStatuses = {};
let lastHealthPercentage;
let lastManaPercentage;
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
let cooldownStartTimes = { healing: 0, attack: 0, support: 0 };
let frameCount = 0;
let lastFpsUpdate = performance.now();
let fps = 0;
let fastestIteration = Infinity;
let slowestIteration = 0;
let iterationStartTime;

export const getLastRuleExecutionTimes = () => {
  return lastRuleExecutionTimes;
};

export const getLastCategoriesExecutionTimes = () => {
  return lastCategoriesExecutionTimes;
};

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

    let battleListRegion = {
      x: battleListStart.x,
      y: battleListStart.y,
      width: 4,
      height: 215,
    };

    let partyListRegion = {
      x: partyListStart.x,
      y: partyListStart.y,
      width: 4,
      height: 215,
    };

    let hpManaRegion = {
      x: healthBar.x,
      y: healthBar.y,
      width: 94,
      height: 14,
    };

    let cooldownsRegion = {
      x: cooldownBar.x,
      y: cooldownBar.y,
      width: 1000,
      height: 1,
    };

    let statusBarRegion = {
      x: statusBar.x,
      y: statusBar.y,
      width: 104,
      height: 9,
    };

    async function loop() {
      iterationStartTime = performance.now();
      frameCount++;

      // Calculate FPS every second
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
        healingCdActive: cooldownBarRegions.healing?.x !== undefined,
        supportCdActive: cooldownBarRegions.support?.x !== undefined,
        attackCdActive: cooldownBarRegions.attack?.x !== undefined,
        characterStatus: characterStatusUpdates,
        monsterNum: monsterNumber,
      };

      // Log cooldown durations
      ['healing', 'attack', 'support'].forEach((cdType) => {
        if (directGameState[`${cdType}CdActive`]) {
          if (cooldownStartTimes[cdType] === 0) {
            cooldownStartTimes[cdType] = performance.now();
          }
        } else if (cooldownStartTimes[cdType] !== 0) {
          const duration = performance.now() - cooldownStartTimes[cdType];
          console.log(`${cdType} CD was active for ${duration.toFixed(2)} milliseconds`);
          cooldownStartTimes[cdType] = 0;
        }
      });

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

      // Update fastest and slowest iteration times
      fastestIteration = Math.min(fastestIteration, iterationDuration);
      slowestIteration = Math.max(slowestIteration, iterationDuration);

      // Log timing information
      console.log(`Iteration timing:
        FPS: ${fps}
        Screen grab: ${(screenGrabEndTime - screenGrabStartTime).toFixed(2)} ms
        Processing: ${(processingEndTime - processingStartTime).toFixed(2)} ms
        Key press (if applicable): ${global.botEnabled ? (keypressEndTime - keypressStartTime).toFixed(2) : 'N/A'} ms
        Total iteration time: ${iterationDuration.toFixed(2)} ms
        Fastest iteration: ${fastestIteration.toFixed(2)} ms
        Slowest iteration: ${slowestIteration.toFixed(2)} ms`);

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
