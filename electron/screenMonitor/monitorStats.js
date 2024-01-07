import { execSync } from 'child_process';
import x11 from 'x11';

let windowGeometryCache = null;
let pickedWindowId = null;
let displayGeometryCache = null;
let lastHealthPercentage = null;
let lastManaPercentage;
let lastManaPercentDispatchTime = Date.now();
let lastHealthPercentDispatchTime = Date.now();

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

async function createClient() {
  return new Promise((resolve, reject) => {
    x11.createClient((err, display) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(display);
    });
  });
}

async function takeScreenshot(X, root, region, logColors, measurePerformance) {
  if (!region) {
    throw new Error('Region is undefined');
  }
  return new Promise((resolve, reject) => {
    const start = performance.now();
    X.GetImage(
      2,
      root,
      region.x || 0,
      region.y || 0,
      region.width || 1920,
      region.height || 1200,
      0xffffff,
      X.ZPixmapFormat,
      (er, img) => {
        if (er) {
          reject(er);
          return;
        }
        const end = performance.now();
        if (measurePerformance) {
          console.log(`Capture screenshot took ${end - start} ms`);
        }

        // Preprocess image data to RGB hex format
        const pixels = [];
        for (let i = 0; i < img.data.length; i += 4) {
          const r = img.data[i + 2].toString(16).padStart(2, '0');
          const g = img.data[i + 1].toString(16).padStart(2, '0');
          const b = img.data[i].toString(16).padStart(2, '0');
          const hex = `#${r}${g}${b}`;
          pixels.push(hex);
        }
        console.log('pixels', pixels.length);
        if (logColors) {
          for (let y = 0; y < region.height; y += 1) {
            for (let x = 0; x < region.width; x += 1) {
              const index = y * region.width + x;
              console.log(
                `At (${x + 1},${y + 1}) found color ${
                  pixels[index]
                }, coordinates of this pixel are (${region.x + x + 1},${region.y + y + 1})`,
              );
            }
          }
        }
        resolve(pixels);
        img.data = null;
      },
    );
  });
}

async function monitorRegion(region, processor, logColors, measurePerformance, interval) {
  const display = await createClient();
  const X = display.client;
  const { root } = display.screen[0];
  let iterationCount = 0;
  let totalTime = 0;
  let minTime = Infinity;
  let maxTime = 0;

  while (true) {
    let startTime, endTime;
    if (measurePerformance && iterationCount !== 0) {
      console.time(`Iteration ${iterationCount}`);
      startTime = Date.now();
    }

    const hexData = await takeScreenshot(X, root, region, logColors, measurePerformance);
    region = await processor(hexData, region);

    if (measurePerformance && iterationCount !== 0) {
      endTime = Date.now();
      console.timeEnd(`Iteration ${iterationCount}`);
      const iterationTime = endTime - startTime;
      totalTime += iterationTime;
      minTime = Math.min(minTime, iterationTime);
      maxTime = Math.max(maxTime, iterationTime);
    }

    iterationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, interval));

    if (measurePerformance && iterationCount > 1) {
      const avgTime = totalTime / (iterationCount - 1);
      console.log(`Average time per iteration: ${avgTime}ms`);
      console.log(`Shortest iteration: ${minTime}ms`);
      console.log(`Longest iteration: ${maxTime}ms`);
    }
  }
}

function findColorSequence(pixels, region, sequence) {
  let currentSequence = [];
  let found = false;

  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const index = y * region.width + x;
      const hex = pixels[index];

      if (hex === sequence[currentSequence.length]) {
        currentSequence.push(hex);
      } else {
        currentSequence = [];
      }

      if (currentSequence.length === sequence.length) {
        return {
          found: true,
          position: { x: region.x + x - sequence.length + 1, y: region.y + y },
        };
      }
    }
  }

  return { found: false };
}

function healingCooldownProcessor(pixels, region) {
  const sequence = ['#737373', '#28323b', '#142632', '#26353d', '#333b42'];
  const result = findColorSequence(pixels, region, sequence);

  if (!result.found) {
    console.log('Cooldown OFF');
    return new Promise((resolve) => setTimeout(() => resolve(region), 100));
  }

  if (result.found) {
    const barWidth = 5;
    const newRegion = {
      x: result.position.x,
      y: result.position.y,
      width: barWidth,
      height: 1,
    };

    region = JSON.parse(JSON.stringify({ ...region, ...newRegion }));

    const colorSequence = findColorSequence(pixels, region, sequence);
    if (!colorSequence.found) {
      console.log('Cooldown ON');
    }

    return region;
  }
}

function combinedBarProcessor(pixels, region) {
  const healthSequence = monitorRegions.health.startSequence;
  const manaSequence = monitorRegions.mana.startSequence;
  const healthResult = findColorSequence(pixels, region, healthSequence);
  const manaResult = findColorSequence(pixels, region, manaSequence);

  if (!healthResult.found || !manaResult.found) {
    console.log('One or both bars NOT FOUND');
    process.send({
      type: 'gameState/setManaPercent',
      payload: { manaPercentage: null },
    });
    process.send({
      type: 'gameState/setHealthPercent',
      payload: { hpPercentage: null },
    });
    const { x, y, width, height } = getWindowGeometry(pickedWindowId);
    region = {
      x,
      y,
      width,
      height,
    };
    return region;
    return new Promise((resolve) => setTimeout(() => resolve(region), 100));
  }

  const combinedRegion = {
    x: Math.min(healthResult.position.x, manaResult.position.x),
    y: Math.min(healthResult.position.y, manaResult.position.y),
    width: Math.max(monitorRegions.health.regionSize.x, monitorRegions.mana.regionSize.x),
    height: Math.abs(healthResult.position.y - manaResult.position.y) + 1,
  };

  region = JSON.parse(JSON.stringify({ ...region, ...combinedRegion }));

  const healthBarWidth = monitorRegions.health.regionSize.x;
  const manaBarWidth = monitorRegions.mana.regionSize.x;
  let healthStart = healthResult.position.x;
  let manaStart = manaResult.position.x;
  let healthEnd = healthStart + healthBarWidth;
  let manaEnd = manaStart + manaBarWidth;
  let healthMid, manaMid;

  while (healthStart < healthEnd) {
    healthMid = Math.floor((healthStart + healthEnd) / 2);
    const index =
      (healthResult.position.y - combinedRegion.y) * combinedRegion.width +
      (healthMid - combinedRegion.x);
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
    const index =
      (manaResult.position.y - combinedRegion.y) * combinedRegion.width +
      (manaMid - combinedRegion.x);
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

  const healthPercentage = Math.floor(
    ((healthStart - healthResult.position.x) / healthBarWidth) * 100,
  );
  const manaPercentage = Math.floor(((manaStart - manaResult.position.x) / manaBarWidth) * 100);

  if (lastHealthPercentage !== healthPercentage) {
    console.log(`HEALTH: ${lastHealthPercentage} -> ${healthPercentage}%`);
    process.send({
      type: 'gameState/setHealthPercent',
      payload: { hpPercentage: healthPercentage },
    });
    lastHealthPercentage = healthPercentage;
    lastHealthPercentDispatchTime = Date.now();
  }

  if (lastManaPercentage !== manaPercentage) {
    console.log(`MANA: ${lastManaPercentage} -> ${manaPercentage}%`);
    process.send({
      type: 'gameState/setManaPercent',
      payload: { manaPercentage: manaPercentage },
    });
    lastManaPercentage = manaPercentage;
    lastManaPercentDispatchTime = Date.now();
  }

  // Ensure that values are dispatched at least every 500ms
  const now = Date.now();
  if (now - lastHealthPercentDispatchTime >= 500) {
    process.send({
      type: 'gameState/setHealthPercent',
      payload: { hpPercentage: healthPercentage },
    });
    lastHealthPercentDispatchTime = now;
  }

  if (now - lastManaPercentDispatchTime >= 500) {
    process.send({
      type: 'gameState/setManaPercent',
      payload: { manaPercentage: manaPercentage },
    });
    lastManaPercentDispatchTime = now;
  }

  return combinedRegion;
}

const getWindowGeometry = (windowId) => {
  // Check if window geometry is cached
  if (!windowGeometryCache) {
    // Get window geometry using xdotool
    const output = execSync(`xdotool getwindowgeometry ${windowId}`).toString();

    // Parse output to get window geometry
    const match = output.match(
      /Position: (-?\d+),(-?\d+) \(screen: \d+\)\n {2}Geometry: (\d+)x(\d+)/,
    );
    if (match) {
      const [, x, y, width, height] = match;

      // Cache window geometry
      windowGeometryCache = {
        x: parseInt(x, 10),
        y: parseInt(y, 10),
        width: parseInt(width, 10),
        height: parseInt(height, 10),
      };
    }
  }

  // Return cached window geometry
  return windowGeometryCache;
};

const getDisplayGeometry = () => {
  if (!displayGeometryCache) {
    // Get display geometry using xdotool
    const output = execSync(`xdotool getdisplaygeometry`).toString();

    // Parse output to get display geometry
    const match = output.match(/(\d+) (\d+)/);
    if (match) {
      const [, width, height] = match;

      // Cache display geometry
      displayGeometryCache = {
        width: parseInt(width, 10),
        height: parseInt(height, 10),
      };
    }
  }

  // Return cached window geometry
  return displayGeometryCache;
};

getDisplayGeometry();

process.on('message', (message) => {
  const { windowId } = message;
  pickedWindowId = windowId;
  const { x, y, width, height } = getWindowGeometry(windowId);
  const windowRegion = {
    x,
    y,
    width,
    height,
  };
  console.log(windowRegion);
  // monitorRegion(windowRegion, healingCooldownProcessor, false, false, 50);
  monitorRegion(windowRegion, combinedBarProcessor, false, false, 50);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in monitorStats.js:', err);
});

process.on('SIGINT', () => {
  process.exit();
});
