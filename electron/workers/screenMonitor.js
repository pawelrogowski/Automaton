import { parentPort } from 'worker_threads';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequences from '../screenMonitor/screenGrabUtils/findSequences.js';
import regionColorSequences from '../constants/regionColorSequeces.js';
import cooldownColorSequences from '../constants/cooldownColorSequences.js';
import statusBarSequences from '../constants/statusBarSequences.js';
import findBoundingRect from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import actionBarItems from '../constants/actionBarItems.js';

let state = null;
let global = null;

let lastHealthPercentage = null;
let lastManaPercentage = null;
const lastCooldownStates = {};
let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let lastDispatchedCharacterStatuses = {};

parentPort.on('message', (updatedState) => {
  state = updatedState;
  ({ global } = state);
});

const waitForWindowId = new Promise((resolve) => {
  parentPort.on('message', (updatedState) => {
    state = updatedState;
    ({ global } = state);
    if (global?.windowId !== null && global?.windowId !== undefined) {
      resolve(global.windowId);
    }
  });
});

async function main() {
  const pickedWindow = await waitForWindowId;
  const imageData = await grabScreen(pickedWindow);
  const startRegions = await findSequences(imageData, regionColorSequences, 1920);
  const { healthBar, manaBar, cooldownBar, statusBar } = startRegions;

  // const actionBarRegionBottom = await findBoundingRect(
  //   imageData,
  //   regionColorSequences.hotkeyBarBottomStart,
  //   regionColorSequences.hotkeyBarBottomEnd,
  //   1920,
  // );

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
    let hpManaImageData;
    let cooldownBarImageData;
    let statusBarImageData;
    let cooldownBarRegions;
    let statusBarRegions;

    try {
      [hpManaImageData, cooldownBarImageData, statusBarImageData] = await Promise.all([
        grabScreen(pickedWindow, hpManaRegion),
        grabScreen(pickedWindow, cooldownsRegion),
        grabScreen(pickedWindow, statusBarRegion),
      ]);

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

      if (newHealthPercentage !== lastDispatchedHealthPercentage) {
        parentPort.postMessage({
          type: 'setHealthPercent',
          payload: { hpPercentage: newHealthPercentage },
        });
        lastDispatchedHealthPercentage = newHealthPercentage;
      }
      lastHealthPercentage = newHealthPercentage;

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

      if (newManaPercentage !== lastDispatchedManaPercentage) {
        parentPort.postMessage({
          type: 'setManaPercent',
          payload: { manaPercentage: newManaPercentage },
        });
        lastDispatchedManaPercentage = newManaPercentage;
      }
      lastManaPercentage = newManaPercentage;

      cooldownBarRegions = await findSequences(cooldownBarImageData, cooldownColorSequences, 1000);

      for (const [key, value] of Object.entries(cooldownBarRegions)) {
        const isCooldownActive = value.x !== undefined;

        if (isCooldownActive !== lastCooldownStates[key]) {
          let type;
          let payload;
          if (key === 'healing') {
            type = 'setHealingCdActive';
            payload = { HealingCdActive: isCooldownActive };
          } else if (key === 'support') {
            type = 'setSupportCdActive';
            payload = { supportCdActive: isCooldownActive };
          } else if (key === 'attack') {
            type = 'setAttackCdActive';
            payload = { attackCdActive: isCooldownActive };
          }
          parentPort.postMessage({ type, payload });
          lastCooldownStates[key] = isCooldownActive;
        }
      }

      statusBarRegions = await findSequences(statusBarImageData, statusBarSequences, 106);

      const characterStatusUpdates = Object.keys(lastDispatchedCharacterStatuses).reduce(
        (acc, key) => {
          acc[key] = false;
          return acc;
        },
        {},
      );

      for (const [key, value] of Object.entries(statusBarRegions)) {
        if (value.x !== undefined) {
          characterStatusUpdates[key] = true;
        }
      }

      const hasStatusChanged = Object.keys(characterStatusUpdates).some(
        (key) => lastDispatchedCharacterStatuses[key] !== characterStatusUpdates[key],
      );

      if (hasStatusChanged) {
        parentPort.postMessage({
          type: 'setCharacterStatus',
          payload: { characterStatus: characterStatusUpdates },
        });

        lastDispatchedCharacterStatuses = { ...characterStatusUpdates };
      }
    } finally {
      // Explicitly release the memory used by the image data
      hpManaImageData = null;
      cooldownBarImageData = null;
      statusBarImageData = null;

      // cooldownBarRegions = null;
      // statusBarRegions = null;
    }

    setTimeout(loop, 50);
  }

  loop();
}

main();
