import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import convertRGBToBGR from '../screenMonitor/screenGrabUtils/convertRGBToBGR.js';
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

const cooldowns = {
  support: [
    [109, 109, 110],
    [93, 236, 233],
    [117, 244, 238],
  ],
  healing: [
    [109, 109, 110],
    [103, 144, 182],
    [14, 84, 141],
  ],
};

let state = null;
let global = null;
let windowGeometry = null;
let updateWindowGeometry = true;
let lastHealthPercentage = null;
let lastManaPercentage = null;
let lastCooldownStates = {};
let statBarPixels = null;
let combinedRegion = null;
// let healthBar = null;
let cooldownBarRegion = null;
let ROI;
let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
// let imageData = null;
let manaBarPosX;
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
  // const { X } = await createX11Client();
  const imageData = await grabScreen(pickedWindow);
  const startRegions = await findSequencesInImageData(imageData, regionColorSequences, 1920);
  const { healthBar, manaBar, cooldownBar } = startRegions;
  console.log(healthBar, manaBar, cooldownBar);

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
    width: 100,
    height: 1,
  };

  async function loop() {
    const hpManaImageData = await grabScreen(pickedWindow, hpManaRegion);
    const cooldownsImageData = await grabScreen(pickedWindow, cooldownsRegion);

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
            [77, 74, 193],
            [45, 45, 105],
            [61, 61, 125],
            [82, 79, 211],
          ],
          92,
        ));

        if (lastManaPercentage !== lastDispatchedManaPercentage) {
          parentPort.postMessage({
            type: 'setManaPercent',
            payload: { manaPercentage: lastManaPercentage },
          });
          lastDispatchedManaPercentage = lastManaPercentage;
        }
      })(),
      // (async () => {
      //   const cooldownPixels = await grabScreen(X, global.windowId, cooldownBarRegion);
      //   const cooldownROIs = await findRegionsOfInterest(
      //     cooldownPixels,
      //     cooldowns,
      //     global.windowId,
      //     false,
      //   );
      // })(),
    ]);

    if (lastHealthPercentage === 0) {
      updateWindowGeometry = true;
    }

    setTimeout(loop, 50);
  }

  loop(); // Start the loop
}

main();

// for (const [key, value] of Object.entries(cooldownROIs)) {
//   if (value.found) {
//     // Grab the screen for the additional check region
//     const checkRegion = {
//       x: value.position.x + 10,
//       y: value.position.y + 12,
//       width: 1,
//       height: 1,
//     };
//     const checkPixels = await grabScreen(X, global.windowId, checkRegion);
//     const isCooldownActive = checkPixels[0] !== '#000000';

//     if (isCooldownActive !== lastCooldownStates[key]) {
//       let type, payload;
//       if (key === 'healing') {
//         type = 'setHealingCdActive';
//         payload = { HealingCdActive: isCooldownActive };
//       } else if (key === 'support') {
//         type = 'setSupportCdActive';
//         payload = { supportCdActive: isCooldownActive };
//       }

//       parentPort.postMessage({ type, payload });
//       lastCooldownStates[key] = isCooldownActive;
//     }
//   } else if (value.found !== lastCooldownStates[key]) {
//     // If the color sequence was not found, set the cooldown as inactive
//     let type, payload;
//     if (key === 'healing') {
//       type = 'setHealingCdActive';
//       payload = { HealingCdActive: false };
//     } else if (key === 'support') {
//       type = 'setSupportCdActive';
//       payload = { supportCdActive: false };
//     }

//     parentPort.postMessage({ type, payload });
//     lastCooldownStates[key] = false;
//   }
// }
