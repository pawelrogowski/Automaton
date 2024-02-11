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
  inRestingArea: {
    direction: 'horizontal',
    sequence: [
      [101, 157, 101],
      [120, 34, 34],
      [26, 45, 27],
    ],
  },
  inProtectedZone: {
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
      [246, 212, 143],
      [246, 212, 143],
      [239, 180, 63],
    ],
  },
  poisoned: {
    direction: 'horizontal',
    sequence: [
      [52, 118, 62],
      [54, 168, 70],
      [52, 118, 62],
    ],
  },
  hasted: {
    direction: 'horizontal',
    sequence: [
      [176, 139, 80],
      [72, 57, 33],
      [249, 249, 248],
    ],
  },
  battleSign: {
    direction: 'horizontal',
    sequence: [
      [182, 122, 85],
      [143, 100, 78],
      [229, 154, 108],
    ],
  },
  burning: {
    direction: 'horizontal',
    sequence: [
      [174, 16, 13],
      [253, 139, 0],
      [218, 32, 4],
      [174, 16, 13],
    ],
  },
  magicShield: {
    direction: 'horizontal',
    sequence: [
      [211, 198, 27],
      [86, 97, 91],
      [154, 26, 55],
    ],
  },
  strenghted: {
    direction: 'horizontal',
    sequence: [
      [37, 170, 21],
      [32, 56, 30],
      [241, 137, 30],
    ],
  },
  cursed: {
    direction: 'horizontal',
    sequence: [
      [9, 9, 9],
      [164, 164, 164],
      [210, 210, 210],
    ],
  },
  electrified: {
    direction: 'horizontal',
    sequence: [
      [254, 232, 255],
      [67, 21, 70],
      [67, 21, 70],
    ],
  },
  paralyzed: {
    direction: 'horizontal',
    sequence: [
      [120, 24, 24],
      [213, 8, 8],
      [243, 2, 2],
    ],
  },
  drowning: {
    direction: 'horizontal',
    sequence: [
      [46, 61, 64],
      [112, 152, 158],
      [28, 151, 158],
    ],
  },
  bleeding: {
    direction: 'horizontal',
    sequence: [
      [235, 37, 58],
      [255, 168, 177],
      [185, 36, 52],
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
let lastDispatchedCharacterStatuses = {};
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

  const hpManaRegion = {
    x: healthBar.x,
    y: healthBar.y,
    width: 92,
    height: 14,
  };

  const cooldownsRegion = {
    x: cooldownBar.x - 10,
    y: cooldownBar.y,
    width: 1000,
    height: 1,
  };

  const statusBarRegion = {
    x: statusBar.x,
    y: statusBar.y,
    width: 106,
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
