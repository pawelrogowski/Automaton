import { parentPort } from 'worker_threads';
import createX11Client from '../screenMonitor/screenGrabUtils/createX11Client.js';
import grabScreen from '../screenMonitor/screenGrabUtils/grabScreen.js';
import getWindowGeometry from '../screenMonitor/windowUtils/getWindowGeometry.js';
import findRegionsOfInterest from '../screenMonitor/searchUtils/findRegionsOfInterest.js';

const regionsOfInterest = {
  cooldownBar: ['#6d6d6e', '#411202', '#310e04'],
};

const cooldowns = {
  support: ['#6d6d6e', '#5dece9', '#75f4ee'],
  healing: ['#6d6d6e', '#6790b5', '#0e548d'],
};

let lastCooldownStates = {};
let state = null;
let global = null;
let cooldownBarRegion = null;
let windowGeometry;

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
  console.log('waiting forr window');
  await waitForWindowId;
  const { display, X } = await createX11Client();

  windowGeometry = await getWindowGeometry(global.windowId);

  console.log(windowGeometry);
  // Find the cooldown bar region before starting the loop
  const pixels = await grabScreen(X, display.screen[0].root, windowGeometry);

  const ROI = await findRegionsOfInterest(pixels, regionsOfInterest, global.windowId, false);
  console.log('Got ROI', ROI);
  if (ROI.cooldownBar && ROI.cooldownBar.found) {
    cooldownBarRegion = {
      x: ROI.cooldownBar.position.x,
      y: ROI.cooldownBar.position.y,
      width: 1200, // Adjust width as needed
      height: 1, // Adjust height as needed
    };
  }

  if (!cooldownBarRegion) {
    return;
  }

  async function loop() {
    const cooldownPixels = await grabScreen(X, display.screen[0].root, cooldownBarRegion);
    const cooldownROIs = await findRegionsOfInterest(
      cooldownPixels,
      cooldowns,
      global.windowId,
      false,
    );

    // Update lastCooldownStates and log changes
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

        // console.log(key, value);
      }
    });

    setTimeout(loop, 50); // Adjust the timeout as needed
  }

  loop(); // Start the loop
}

main();
