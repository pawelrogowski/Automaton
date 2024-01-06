import { Performance } from 'perf_hooks';

import robotjs from 'robotjs';
import { exec, execSync } from 'child_process';
import x11 from 'x11';

let windowGeometryCache = null;
let displayGeometryCache = null;
let lastHealthPercentage = null;
let lastManaPercentage = null;

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

function healthBarProcessor(pixels, region) {
  const sequence = ['#783d40', '#d34f4f']; // Only the start sequence
  const result = findColorSequence(pixels, region, sequence);

  if (result.found) {
    const healthBarWidth = 92;
    const healthBarEndPosition = result.position.x + healthBarWidth;
    const newRegion = {
      x: result.position.x,
      y: result.position.y,
      width: healthBarWidth,
      height: 1, // Assuming the health bar is only 1 pixel high
    };

    region = JSON.parse(JSON.stringify({ ...region, ...newRegion }));

    let start = region.x;
    let end = healthBarEndPosition;
    let mid;

    while (start < end) {
      mid = Math.floor((start + end) / 2);
      const index = mid - region.x;
      const hex = pixels[index];

      if (hex === '#db4f4f') {
        start = mid + 1;
      } else {
        end = mid;
      }

      // Break the loop if the desired color is not found within the specified range
      if (start > end) {
        break;
      }
    }

    const currentPercentage = ((start - region.x) / healthBarWidth) * 100;

    if (lastHealthPercentage !== currentPercentage) {
      console.log(`HEALTH: ${Math.floor(currentPercentage)}%`);
      process.send({
        type: 'gameState/setHealthPercent',
        payload: { hpPercentage: currentPercentage },
      });
      lastHealthPercentage = currentPercentage;
    }

    return region;
  }
}

function manaBarProcessor(pixels, region) {
  const sequence = ['#3d3d7d', '#524fd3']; // Only the start sequence
  const result = findColorSequence(pixels, region, sequence);

  if (result.found) {
    const manaBarWidth = 92;
    const manaBarEndPosition = result.position.x + manaBarWidth;
    const newRegion = {
      x: result.position.x,
      y: result.position.y,
      width: manaBarWidth,
      height: 1, // Assuming the health bar is only 1 pixel high
    };

    region = JSON.parse(JSON.stringify({ ...region, ...newRegion }));

    let start = region.x;
    let end = manaBarEndPosition;
    let mid;

    while (start < end) {
      mid = Math.floor((start + end) / 2);
      const index = mid - region.x;
      const hex = pixels[index];

      if (hex === '#5350da' || hex === '#4d4ac2' || hex === '#2d2d69') {
        start = mid + 1;
      } else {
        end = mid;
      }

      // Break the loop if the desired color is not found within the specified range
      if (start > end) {
        break;
      }
    }

    const currentPercentage = ((start - region.x) / manaBarWidth) * 100;

    if (lastManaPercentage !== currentPercentage) {
      console.log(`MANA: ${Math.floor(currentPercentage)}%`);
      process.send({
        type: 'gameState/setManaPercent',
        payload: { manaPercentage: currentPercentage },
      });
      lastManaPercentage = currentPercentage;
    }

    return region;
  }
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

  const { x, y, width, height } = getWindowGeometry(windowId);
  const windowRegion = {
    x,
    y,
    width,
    height,
  };
  console.log(windowRegion);
  monitorRegion(windowRegion, healthBarProcessor, false, false, 100);
  monitorRegion(windowRegion, manaBarProcessor, false, false, 100);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in monitorStats.js:', err);
});

process.on('SIGINT', () => {
  process.exit();
});
