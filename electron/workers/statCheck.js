import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { execSync } from 'child_process';

const regionsOfInterest = {
  healthBar: ['#783d40', '#d34f4f'],
  manaBar: ['#3d3d7d', '#524fd3'],
  healingCd: ['#737373', '#28323b'],
};

let state = null;
let global = null;
let windowGeometry = null;
let updateWindowGeometry = true;
let lastHealthPercentage = null;
let lastManaPercentage = null;
let statBarPixels = null;
let combinedRegion = null;
let healthBar = null;
let manaBar = null;
let ROI;
let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
let pixels = null;
let manaBarPosX;
let manaBarPosY;

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

  setInterval(async () => {
    if (updateWindowGeometry) {
      windowGeometry = await getWindowGeometry(global.windowId);
      pixels = await grabScreen(X, display.screen[0].root, windowGeometry);
      ROI = await findRegionsOfInterest(pixels, windowGeometry, regionsOfInterest, global.windowId);

      healthBar = ROI.healthBar;
      manaBarPosX = healthBar.position.x;
      manaBarPosY = healthBar.position.y + 13;

      combinedRegion = {
        x: healthBar.position.x,
        y: healthBar.position.y,
        width: 92,
        height: 14,
      };
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
    console.log(lastHealthPercentage, lastManaPercentage);
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
    if (lastHealthPercentage === 0) {
      updateWindowGeometry = true;
    }
  }, 100);
}

main();
