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
let lastHealthPercentage = null;
let lastManaPercentage = null;
let statBarPixels = null;
let combinedRegion = null;
let healthBar = null;
let manaBar = null;
let ROI;
let lastDispatchedHealthPercentage = null;
let lastDispatchedManaPercentage = null;
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
  const pixels = await grabScreen(X, display.screen[0].root, windowGeometry);

  // Calculate the filled percentage of the health and mana bars

  setInterval(async () => {
    if (!lastHealthPercentage || !lastManaPercentage || lastHealthPercentage === 0) {
      windowGeometry = await getWindowGeometry(global.windowId);
      ROI = await findRegionsOfInterest(pixels, windowGeometry, regionsOfInterest, global.windowId);

      healthBar = ROI.healthBar;
      manaBar = ROI.manaBar;

      combinedRegion = {
        x: Math.min(healthBar.position.x, manaBar.position.x),
        y: Math.min(healthBar.position.y, manaBar.position.y),
        width: 92,
        height: 14,
      };
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
      manaBar.position,
      combinedRegion,
      statBarPixels,
      ['#5350da', '#4d4ac2', '#2d2d69', '#3d3d7d', '#524fd3'],
      92,
    ));

    if (lastHealthPercentage !== lastDispatchedHealthPercentage) {
      console.log('HP:', lastHealthPercentage, 'MP:', lastManaPercentage);
      parentPort.postMessage({
        type: 'setHealthPercent',
        payload: { hpPercentage: lastHealthPercentage },
      });
      lastDispatchedHealthPercentage = lastHealthPercentage;
    }

    if (lastManaPercentage !== lastDispatchedManaPercentage) {
      console.log('HP:', lastHealthPercentage, 'MP:', lastManaPercentage);
      parentPort.postMessage({
        type: 'setManaPercent',
        payload: { manaPercentage: lastManaPercentage },
      });
      lastDispatchedManaPercentage = lastManaPercentage;
    }

    if (lastHealthPercentage < 95) {
      execSync('xdotool key F6');
    }
  }, 100);
}

main();
