const x11 = require('x11');
const { performance } = require('perf_hooks');

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
      region.x,
      region.y,
      region.width,
      region.height,
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
          for (let y = 0; y < region.height; y++) {
            for (let x = 0; x < region.width; x++) {
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

async function monitorRegion(regionObj, processor, logColors, measurePerformance, interval) {
  const display = await createClient();
  const X = display.client;
  const { root } = display.screen[0];

  while (true) {
    const hexData = await takeScreenshot(X, root, regionObj.value, logColors, measurePerformance);
    await processor(hexData, regionObj);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

function findColorSequence(pixels, region, sequence) {
  let currentSequence = [];
  let found = false;

  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
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

function healthBarProcessor(pixels, regionObj) {
  const sequence = ['#783d40', '#d34f4f']; // Only the start sequence
  const result = findColorSequence(pixels, regionObj.value, sequence);

  if (result.found) {
    const healthBarWidth = 92;
    const healthBarEndPosition = result.position.x + healthBarWidth;
    const newRegion = {
      x: result.position.x,
      y: result.position.y,
      width: healthBarWidth,
      height: 1, // Assuming the health bar is only 1 pixel high
    };
    console.log(
      `Health bar found at position (${result.position.x},${result.position.y}) with width ${healthBarWidth}`,
    );
    console.log(`Health bar region: ${JSON.stringify(newRegion)}`);
    // Use newRegion for subsequent screenshots
    regionObj.value = newRegion;

    // Calculate the current percentage of the health bar
    let start = regionObj.value.x;
    let end = healthBarEndPosition;
    let mid;

    while (start < end) {
      mid = Math.floor((start + end) / 2);
      const index = mid - regionObj.value.x;
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

    const currentPercentage = ((start - regionObj.value.x) / healthBarWidth) * 100;
    console.log(`HEALTH: ${Math.floor(currentPercentage)}%`);
  } else {
    console.log('No sequence found');
  }
}

let screenRegion = {
  value: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1200,
  },
};

let healthRegion = {
  value: {
    x: 1700,
    y: 145,
    width: 200,
    height: 50,
  },
};

monitorRegion(screenRegion, healthBarProcessor, false, true, 100);
