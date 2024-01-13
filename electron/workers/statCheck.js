import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';

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
  // console.log('1.', 'waiting for window');
  await waitForWindowId;
  // console.log('1.', 'window picked:', global.windowId);

  // console.log('2.', 'creating x11 client');
  const { display, X } = await createX11Client();
  // console.log('2.', 'x11 client created');

  // console.log('3.', 'getting initial window geometry');
  windowGeometry = await getWindowGeometry(global.windowId);
  // console.log('3.', 'succesfully got window geometry:', windowGeometry);

  // console.log('4.', 'starting the loop');
  async function loop() {
    if (updateWindowGeometry) {
      // console.log('5.', 'getting new window geometry');
      windowGeometry = await getWindowGeometry(global.windowId);
      // console.log('5.', 'succesfully got new window geometry:', windowGeometry);

      // console.log('6.', 'getting the pixel data from window region');
      pixels = await grabScreen(X, display.screen[0].root, windowGeometry);
      // console.log('6.', 'succesfully got the pixel data, pixels in region:', pixels.length);

      // console.log('7.', 'getting ROI start coordinates');
      ROI = await findRegionsOfInterest(pixels, regionsOfInterest, global.windowId);
      // console.log('7.', 'succesfully got ROI start coordinates:', ROI);

      // console.log('8.', 'getting health bar coordinnates from ROI output');
      healthBar = ROI.healthBar;
      manaBarPosX = healthBar.position.x;
      manaBarPosY = healthBar.position.y + 13;
      // console.log('8.', 'succesfully got ROI start coordinates:', healthBar.position, {
      //   x: manaBarPosX,
      //   y: manaBarPosY,
      // });

      // console.log('9.', 'creating combined region object for bars');
      combinedRegion = {
        x: healthBar.position.x,
        y: healthBar.position.y,
        width: 92,
        height: 14,
      };
      // console.log('9.', 'succesfull combined region object: for bars', combinedRegion);
      updateWindowGeometry = false;
    }
    // console.log('10.', 'grabbing pixels of combined region for bars');
    statBarPixels = await grabScreen(X, display.screen[0].root, combinedRegion);
    // console.log(
    //   '10.',
    //   'succesfully grabbed pixels of combined region for bars',
    //   statBarPixels.length,
    // );

    // console.log('11.', 'calculating current percentage of the bars');
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
    // console.log(
    //   '11.',
    //   'succesfully calculated current percentage of the bars:',
    //   lastHealthPercentage,
    //   lastManaPercentage,
    // );

    // console.log('12.', 'dispatching an update if value changed');
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
    // console.log('12.', 'succesfully processed dispatches');

    // console.log('13.', 'checking if health bar is present');
    if (lastHealthPercentage === 0) {
      updateWindowGeometry = true;
    }
    // console.log('13.', 'succesfully checked if health bar is present:', !updateWindowGeometry);

    // Schedule the next iteration after the current one completes
    setTimeout(loop, 100);
  }

  loop(); // Start the loop
}

main();
