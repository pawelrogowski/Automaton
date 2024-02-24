import { parentPort } from 'worker_threads';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequencesInImageData from '../screenMonitor/screenGrabUtils/findSequencesInImageData.js';
import regionColorSequences from '../constants/regionColorSequeces.js';
import cooldownColorSequences from '../constants/cooldownColorSequences.js';
import statusBarSequences from '../constants/statusBarSequences.js';

let state = null;
let global = null;

let lastHealthPercentage = null;
let lastManaPercentage = null;
const lastCooldownStates = {}; // eslint-disable-next-line no-unused-vars
let cooldownsImageData;
// let healthBar = null;

let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let lastDispatchedCharacterStatuses = {};
let cooldownBarImageData;
let cooldownBarRegions;
// eslint-disable-next-line no-unused-vars
let statusBarX;
let statusBarImageData;
let statusBarRegions;

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
  const startRegions = await findSequencesInImageData(imageData, regionColorSequences, 1920);
  const { healthBar, manaBar, cooldownBar, statusBar, hotkeyBarBottomStart, hotkeyBarBottomEnd } =
    startRegions;
  console.log(
    'region objects: ',
    healthBar,
    manaBar,
    cooldownBar,
    statusBar,
    hotkeyBarBottomStart,
    hotkeyBarBottomEnd,
  );
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
    const hpManaImageData = await grabScreen(pickedWindow, hpManaRegion);
    cooldownsImageData = await grabScreen(pickedWindow, cooldownsRegion);

    // Process HP, mana, and cooldown areas concurrently
    await Promise.all([
      (async () => {
        ({ percentage: lastHealthPercentage } = await calculatePercentages(
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
        ));

        if (lastHealthPercentage !== lastDispatchedHealthPercentage) {
          parentPort.postMessage({
            type: 'setHealthPercent',
            payload: { hpPercentage: lastHealthPercentage },
          });
          lastDispatchedHealthPercentage = lastHealthPercentage;
        }
      })(),
      (async () => {
        ({ percentage: lastManaPercentage } = await calculatePercentages(
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
        ));
        // ['#5350da', '#4d4ac2', '#2d2d69', '#3d3d7d', '#524fd3'],
        if (lastManaPercentage !== lastDispatchedManaPercentage) {
          parentPort.postMessage({
            type: 'setManaPercent',
            payload: { manaPercentage: lastManaPercentage },
          });
          lastDispatchedManaPercentage = lastManaPercentage;
        }
      })(),
      (async () => {
        cooldownBarImageData = await grabScreen(pickedWindow, cooldownsRegion);

        cooldownBarRegions = await findSequencesInImageData(
          cooldownBarImageData,
          cooldownColorSequences,
          1000,
        );

        // eslint-disable-next-line no-restricted-syntax
        for (const [key, value] of Object.entries(cooldownBarRegions)) {
          const isCooldownActive = value.x !== undefined; // Cooldown is active if the x position is present

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
            console.log({ type, payload });
            parentPort.postMessage({ type, payload });
            lastCooldownStates[key] = isCooldownActive;
          }
        }
      })(),
      (async () => {
        statusBarImageData = await grabScreen(pickedWindow, statusBarRegion);

        statusBarRegions = await findSequencesInImageData(
          statusBarImageData,
          statusBarSequences,
          106,
        );

        // Initialize an object to hold the status of each character status with all statuses set to false
        const characterStatusUpdates = Object.keys(lastDispatchedCharacterStatuses).reduce(
          (acc, key) => {
            acc[key] = false; // Initialize all statuses to false
            return acc;
          },
          {},
        );

        // Update the characterStatusUpdates object based on the detected status bar regions
        // eslint-disable-next-line no-restricted-syntax
        for (const [key, value] of Object.entries(statusBarRegions)) {
          if (value.x !== undefined) {
            // status is present if the x position is present
            characterStatusUpdates[key] = true;
          }
        }

        // Check if there's any change in character statuses since the last dispatch
        const hasStatusChanged = Object.keys(characterStatusUpdates).some(
          (key) => lastDispatchedCharacterStatuses[key] !== characterStatusUpdates[key],
        );

        if (hasStatusChanged) {
          // Dispatch an action to update the character statuses in the store
          parentPort.postMessage({
            type: 'setCharacterStatus',
            payload: { characterStatus: characterStatusUpdates },
          });

          // Update the last dispatched character statuses
          lastDispatchedCharacterStatuses = { ...characterStatusUpdates };
        }
      })(),
    ]);

    setTimeout(loop, 1);
  }

  loop();
}

main();
