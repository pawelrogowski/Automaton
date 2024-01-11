import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import getDisplayGeometry from '../screenMonitor/windowUtils/getDisplayGeometry.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';
import binarySearch from '../screenMonitor/searchUtils/binarySearch.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';

const regionsOfInterest = {
  healthBar: ['#783d40', '#d34f4f'],
  manaBar: ['#3d3d7d', '#524fd3'],
  healingCd: ['#737373', '#28323b'],
};

let state = null;
let global = null;
let windowGeometry = null;
let lastHealthPercentage = null;
let lastHealthPercentDispatchTime = Date.now();
let lastManaPercentage = null;
let lastManaPercentDispatchTime = Date.now();

const monitorRegions = {
  health: {
    startSequence: ['#783d40', '#d34f4f'],
    regionSize: { x: 92, y: 1 },
  },
  mana: {
    startSequence: ['#3d3d7d', '#524fd3'],
    regionSize: { x: 92, y: 1 },
  },
};

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

  const ROI = await findRegionsOfInterest(
    pixels,
    windowGeometry,
    regionsOfInterest,
    global.windowId,
  );
  const { healthBar, manaBar } = ROI;

  // Combine health and mana regions
  const combinedRegion = {
    x: Math.min(healthBar.position.x, manaBar.position.x),
    y: Math.min(healthBar.position.y, manaBar.position.y),
    width: Math.max(monitorRegions.health.regionSize.x, monitorRegions.mana.regionSize.x),
    height: Math.abs(healthBar.position.y - manaBar.position.y) + 1,
  };
  console.log(combinedRegion);

  // Calculate the filled percentage of the health and mana bars
  const healthBarWidth = monitorRegions.health.regionSize.x;
  const manaBarWidth = monitorRegions.mana.regionSize.x;
  let healthStart = healthBar.position.x;
  let manaStart = manaBar.position.x;
  const healthEnd = healthStart + healthBarWidth;
  const manaEnd = manaStart + manaBarWidth;

  const healthColors = ['#db4f4f', '#c84a4d', '#673135'];
  const manaColors = ['#5350da', '#4d4ac2', '#2d2d69'];

  const combinedPixels = await grabScreen(X, display.screen[0].root, combinedRegion);

  healthStart = await binarySearch(
    healthStart,
    healthEnd,
    healthBar.position,
    combinedRegion,
    combinedPixels,
    healthColors,
  );
  manaStart = await binarySearch(
    manaStart,
    manaEnd,
    manaBar.position,
    combinedRegion,
    combinedPixels,
    manaColors,
  );

  ({ lastHealthPercentage, lastHealthPercentDispatchTime } = await calculatePercentages(
    healthStart,
    healthBar.position,
    healthBarWidth,
    lastHealthPercentage,
    lastHealthPercentDispatchTime,
  ));
  ({ lastManaPercentage, lastManaPercentDispatchTime } = await calculatePercentages(
    manaStart,
    manaBar.position,
    manaBarWidth,
    lastManaPercentage,
    lastManaPercentDispatchTime,
  ));

  console.log(lastHealthPercentage, lastManaPercentage);
}

main();
