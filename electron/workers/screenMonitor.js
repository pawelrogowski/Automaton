import { parentPort } from 'worker_threads';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import findSequencesInImageData from '../screenMonitor/screenGrabUtils/findSequencesInImageData.js';

const regionColorSequences = {
  healthBar: {
    direction: 'horizontal',
    sequence: [
      [120, 61, 64],
      [211, 79, 79],
    ],
  },
  manaBar: {
    direction: 'horizontal',
    sequence: [
      [61, 61, 125],
      [82, 79, 211],
    ],
  },
  cooldownBar: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [65, 18, 2],
      [49, 14, 4],
    ],
  },
  statusBar: {
    direction: 'horizontal',
    sequence: [
      [116, 116, 116],
      [73, 74, 74],
      [73, 74, 73],
      [72, 72, 73],
      [69, 70, 70],
      [74, 74, 75],
      [78, 78, 79],
      [27, 28, 28],
      [43, 44, 43],
    ],
  },
};

const cooldownColorSequences = {
  attack: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [217, 60, 7],
      [162, 46, 12],
    ],
  },
  healing: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [103, 144, 181],
      [14, 84, 141],
    ],
  },
  support: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [93, 236, 233],
      [117, 244, 238],
    ],
  },
  focus: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [210, 147, 186],
      [122, 10, 70],
    ],
  },
  ultimateStrikes: {
    direction: 'horizontal',
    sequence: [
      [109, 109, 110],
      [193, 137, 132],
      [208, 56, 34],
    ],
  },
};

const statusBarSequences = {
  restingZone: {
    direction: 'horizontal',
    sequence: [
      [101, 157, 101],
      [120, 34, 34],
      [26, 45, 27],
    ],
  },
  protectionZone: {
    direction: 'horizontal',
    sequence: [
      [172, 201, 246],
      [29, 77, 155],
      [118, 165, 242],
    ],
  },
  hungry: {
    direction: 'horizontal',
    sequence: [
      [239, 180, 63],
      [54, 38, 5],
      [54, 38, 5],
    ],
  },
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
  const { healthBar, manaBar, cooldownBar, statusBar } = startRegions;
  console.log(healthBar, manaBar, cooldownBar, statusBar);
  manaBarPosX = healthBar.x;
  manaBarPosY = healthBar.y + 13;
  statusBarX = statusBar.x + 8;

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

  const statusBarRegion = {
    x: statusBarX,
    y: statusBar.y,
    width: 106,
    height: 9,
  };

  async function loop() {
    const hpManaImageData = await grabScreen(pickedWindow, hpManaRegion);
    cooldownsImageData = await grabScreen(pickedWindow, cooldownsRegion);
    const statusBarData = await grabScreen(pickedWindow, statusBarRegion);

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
            }

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

        // eslint-disable-next-line no-restricted-syntax
        for (const [key, value] of Object.entries(statusBarRegions)) {
          const isStatusPresent = value.x !== undefined; // status is present if the x position is present

          if (isStatusPresent !== lastCooldownStates[key]) {
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

    setTimeout(loop, 5);
  }

  loop();
}

main();