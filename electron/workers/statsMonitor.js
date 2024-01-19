import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';

const regionsOfInterest = {
  healthBar: ['#783d40', '#d34f4f'],
  manaBar: ['#3d3d7d', '#524fd3'],
  cooldownBar: ['#6d6d6e', '#411202', '#310e04'],
};

const cooldowns = {
  support: ['#6d6d6e', '#5dece9', '#75f4ee'],
  healing: ['#6d6d6e', '#6790b5', '#0e548d'],
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
let healthBar = null;
let cooldownBarRegion = null;
let ROI;
let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
let pixels = null;
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
      resolve();
    }
  });
});

async function main() {
  await waitForWindowId;
  const { display, X } = await createX11Client();
  windowGeometry = await getWindowGeometry(global.windowId);

  async function loop() {
    if (updateWindowGeometry) {
      windowGeometry = await getWindowGeometry(global.windowId);
      pixels = await grabScreen(X, display.screen[0].root, windowGeometry);
      ROI = await findRegionsOfInterest(pixels, regionsOfInterest, global.windowId);
      healthBar = ROI.healthBar;
      manaBarPosX = healthBar.position.x;
      manaBarPosY = healthBar.position.y + 13;
      combinedRegion = {
        x: healthBar.position.x,
        y: healthBar.position.y,
        width: 92,
        height: 14,
      };

      if (ROI.cooldownBar && ROI.cooldownBar.found) {
        cooldownBarRegion = {
          x: ROI.cooldownBar.position.x,
          y: ROI.cooldownBar.position.y,
          width: 1200, // Adjust width as needed
          height: 1, // Adjust height as needed
        };
      }

      updateWindowGeometry = false;
    }

    statBarPixels = await grabScreen(X, display.screen[0].root, combinedRegion);

    ({ percentage: lastHealthPercentage } = await calculatePercentages(
      healthBar.position,
      combinedRegion,
      statBarPixels,
      ['#783d40', '#d34f4f', '#db4f4f', '#c24a4a', '#642e31'],
      92,
    ));
    ({ percentage: lastManaPercentage } = await calculatePercentages(
      { x: manaBarPosX, y: manaBarPosY },
      combinedRegion,
      statBarPixels,
      ['#5350da', '#4d4ac2', '#2d2d69', '#3d3d7d', '#524fd3'],
      92,
    ));

    if (lastHealthPercentage !== lastDispatchedHealthPercentage) {
      parentPort.postMessage({
        type: 'setHealthPercent',
        payload: { hpPercentage: lastHealthPercentage },
      });
      lastDispatchedHealthPercentage = lastHealthPercentage;
    }

    if (lastManaPercentage !== lastDispatchedManaPercentage) {
      parentPort.postMessage({
        type: 'setManaPercent',
        payload: { manaPercentage: lastManaPercentage },
      });
      lastDispatchedManaPercentage = lastManaPercentage;
    }

    if (cooldownBarRegion) {
      const cooldownPixels = await grabScreen(X, display.screen[0].root, cooldownBarRegion);
      const cooldownROIs = await findRegionsOfInterest(
        cooldownPixels,
        cooldowns,
        global.windowId,
        false,
      );

      Object.entries(cooldownROIs).forEach(([key, value]) => {
        if (value.found !== lastCooldownStates[key]) {
          let type, payload;
          if (key === 'healing') {
            type = 'setHealingCdActive';
            payload = { HealingCdActive: value.found };
          } else if (key === 'support') {
            type = 'setSupportCdActive';
            payload = { supportCdActive: value.found };
          }

          parentPort.postMessage({ type, payload });
          lastCooldownStates[key] = value.found;
        }
      });
    }

    if (lastHealthPercentage === 0) {
      updateWindowGeometry = true;
    }

    setTimeout(loop, 55);
  }

  loop(); // Start the loop
}

main();
