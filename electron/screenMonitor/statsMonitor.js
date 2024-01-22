import createX11Client from './screenGrabUtils/createX11Client.js';
import getWindowGeometry from './windowUtils/getWindowGeometry.js';
import grabScreen from './screenGrabUtils/grabScreen.js';
import findColorSequence from './searchUtils/findColorSequence.js';
import { getSelectedWindowId } from '../menus/windowSelection.js';
import setGlobalState from '../setGlobalState.js';
import store from '../store.js';

console.log(store.getState());

const pickedWindowId = getSelectedWindowId;
let lastHealthPercentage = null;
let lastManaPercentage = null;
let lastManaPercentDispatchTime = Date.now();
let lastHealthPercentDispatchTime = Date.now();
let areBarsVisible = null;
let lastBarDispatchedValue = false;
let cooldownRegion = null;
let lastHealingCooldownStatus = null;
let lastHealCdChange = null;

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

async function monitorRegion(region, processor, logColors, measurePerformance, interval) {
  const display = await createX11Client();
  const X = display.client;
  const { root } = display.screen[0];

  while (true) {
    const hexData = await grabScreen(X, root, region, logColors, measurePerformance);
    region = await processor(hexData, region);

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

function combinedBarProcessor(pixels, region) {
  const healthSequence = monitorRegions.health.startSequence;
  const manaSequence = monitorRegions.mana.startSequence;
  let lastBarVisibilityStatus = false;
  const {
    found: healthFound,
    position: { x: healthX, y: healthY },
  } = findColorSequence(pixels, region, healthSequence, pickedWindowId);

  const {
    found: manaFound,
    position: { x: manaX, y: manaY },
  } = findColorSequence(pixels, region, manaSequence, pickedWindowId);

  areBarsVisible = healthFound && manaFound;

  if (areBarsVisible !== lastBarDispatchedValue) {
    // process.send({
    //   type: 'gameState/setBarVisibility',
    //   payload: { isBarVisible: areBarsVisible },
    // });
    lastBarDispatchedValue = areBarsVisible;
  }

  if (!areBarsVisible) {
    lastHealthPercentage = null;
    lastManaPercentage = null;
    const { x, y, width, height } = getWindowGeometry(pickedWindowId);
    region = {
      x,
      y,
      width,
      height,
    };
    return region;
  }

  const combinedRegion = {
    x: Math.min(healthX, manaX),
    y: Math.min(healthY, manaY),
    width: Math.max(monitorRegions.health.regionSize.x, monitorRegions.mana.regionSize.x),
    height: Math.abs(healthY - manaY) + 1,
  };
  region = combinedRegion;

  const healthBarWidth = monitorRegions.health.regionSize.x;
  const manaBarWidth = monitorRegions.mana.regionSize.x;
  let healthStart = healthX;
  let manaStart = manaX;
  let healthEnd = healthStart + healthBarWidth;
  let manaEnd = manaStart + manaBarWidth;
  let healthMid, manaMid;

  while (healthStart < healthEnd) {
    healthMid = Math.floor((healthStart + healthEnd) / 2);
    const index =
      (healthY - combinedRegion.y) * combinedRegion.width + (healthMid - combinedRegion.x);
    const hex = pixels[index];

    if (hex === '#db4f4f' || hex === '#c84a4d' || hex === '#673135') {
      healthStart = healthMid + 1;
    } else {
      healthEnd = healthMid;
    }

    if (healthStart > healthEnd) {
      break;
    }
  }

  while (manaStart < manaEnd) {
    manaMid = Math.floor((manaStart + manaEnd) / 2);
    const index = (manaY - combinedRegion.y) * combinedRegion.width + (manaMid - combinedRegion.x);
    const hex = pixels[index];

    if (hex === '#5350da' || hex === '#4d4ac2' || hex === '#2d2d69') {
      manaStart = manaMid + 1;
    } else {
      manaEnd = manaMid;
    }

    if (manaStart > manaEnd) {
      break;
    }
  }

  const healthPercentage = areBarsVisible
    ? Math.floor(((healthStart - healthX) / healthBarWidth) * 100)
    : null;
  const manaPercentage = areBarsVisible
    ? Math.floor(((manaStart - manaX) / manaBarWidth) * 100)
    : null;

  if (lastHealthPercentage !== healthPercentage) {
    if (lastHealthPercentage !== null && healthPercentage !== 0) {
      console.log(`HEALTH: ${lastHealthPercentage} -> ${healthPercentage}%`);

      // process.send({
      //   type: 'gameState/setHealthPercent',
      //   payload: { hpPercentage: healthPercentage },
      // });

      lastHealthPercentage = healthPercentage;
      lastHealthPercentDispatchTime = Date.now();
    }
    lastHealthPercentage = healthPercentage;
  }

  if (lastManaPercentage !== manaPercentage) {
    if (lastManaPercentage !== null && manaPercentage !== 0) {
      console.log(`MANA: ${lastManaPercentage} -> ${manaPercentage}%`);
      // process.send({
      //   type: 'gameState/setManaPercent',
      //   payload: { manaPercentage: manaPercentage },
      // });
      lastManaPercentage = manaPercentage;
      lastManaPercentDispatchTime = Date.now();
    }
    lastManaPercentage = manaPercentage;
  }

  // Ensure that values are dispatched at least every 500ms
  const now = Date.now();
  if (now - lastHealthPercentDispatchTime >= 500) {
    // process.send({
    //   type: 'gameState/setHealthPercent',
    //   payload: { hpPercentage: healthPercentage },
    // });
    lastHealthPercentDispatchTime = now;
  }

  if (now - lastManaPercentDispatchTime >= 500) {
    // process.send({
    //   type: 'gameState/setManaPercent',
    //   payload: { manaPercentage: manaPercentage },
    // });
    lastManaPercentDispatchTime = now;
  }

  return combinedRegion;
}

const healingCooldownProcessor = (pixels, region) => {
  return new Promise((resolve) => {
    const sequenceOff = ['#737373', '#28323b'];
    const sequenceCdBar = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'];

    if (!cooldownRegion) {
      const offResult = findColorSequence(pixels, region, sequenceOff, pickedWindowId, true);
      if (offResult.found) {
        cooldownRegion = {
          x: offResult.position.x + 1,
          y: offResult.position.y + 10,
          width: 5,
          height: 1,
        };
      }
    }

    if (cooldownRegion) {
      const onResult = findColorSequence(
        pixels,
        cooldownRegion,
        sequenceCdBar,
        pickedWindowId,
        false,
      );
      if (onResult.found !== lastHealingCooldownStatus) {
        if (lastHealCdChange) {
          console.log(
            `${lastHealingCooldownStatus} -> ${onResult.found}: ${Date.now() - lastHealCdChange}ms`,
          );
        }
        lastHealCdChange = Date.now();

        setGlobalState('gameState/setHealingCooldownVisibility', {
          isHealingCooldown: onResult.found,
        });
        lastHealingCooldownStatus = onResult.found;
      }

      resolve(cooldownRegion);
    } else {
      resolve(region);
    }
  });
};

store.subscribe(() => {
  const { global } = store.getState();
  const { windowId, healingEnabled } = global;

  if (healingEnabled) {
    monitorRegion(getWindowGeometry(windowId), healingCooldownProcessor, false, false, 50);
  }
});

// monitorRegion(getWindowGeometry(pickedWindowId), combinedBarProcessor, false, false, 50);
