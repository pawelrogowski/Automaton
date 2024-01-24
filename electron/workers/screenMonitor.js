import { parentPort } from 'worker_threads';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequencesInImageData from '../screenMonitor/screenGrabUtils/findSequencesInImageData.js';

const regionColorSequences = {
  healthBar: [
    [120, 61, 64],
    [211, 79, 79],
  ],
  manaBar: [
    [61, 61, 125],
    [82, 79, 211],
  ],
  cooldownBar: [
    [109, 109, 110],
    [65, 18, 2],
    [49, 14, 4],
  ],
};

const cooldownColorSequences = {
  attack: [
    [109, 109, 110],
    [217, 60, 7],
    [162, 46, 12],
  ],
  healing: [
    [109, 109, 110],
    [103, 144, 181],
    [14, 84, 141],
  ],
  support: [
    [109, 109, 110],
    [93, 236, 233],
    [117, 244, 238],
  ],
  focus: [
    [109, 109, 110],
    [210, 147, 186],
    [122, 10, 70],
  ],
  ultimateStrikes: [
    [109, 109, 110],
    [193, 137, 132],
    [208, 56, 34],
  ],
};

let state = null;
let global = null;

let lastHealthPercentage = null;
let lastManaPercentage = null;
const lastCooldownStates = {}; // eslint-disable-next-line no-unused-vars
let cooldownsImageData;
// let healthBar = null;

let lastDispatchedHealthPercentage;
let lastDispatchedManaPercentage;
let cooldownBarImageData;
let cooldownBarRegions;
// eslint-disable-next-line no-unused-vars
let manaBarPosX;
// eslint-disable-next-line no-unused-vars
let manaBarPosY;

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
  const { healthBar, manaBar, cooldownBar } = startRegions;
  // console.log(healthBar, manaBar, cooldownBar);

  manaBarPosX = healthBar.x;
  manaBarPosY = healthBar.y + 13;

  const hpManaRegion = {
    x: healthBar.x,
    y: healthBar.y,
    width: 92,
    height: 14,
  };

  const cooldownsRegion = {
    x: cooldownBar.x,
    y: cooldownBar.y,
    width: 1000,
    height: 1,
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
          100,
        );

        // console.log('whaaaaaat', cooldownBarRegions);
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
            }

            parentPort.postMessage({ type, payload });
            lastCooldownStates[key] = isCooldownActive;
          }
        }
      })(),
    ]);

    setTimeout(loop, 55);
  }

  loop();
}

main();
