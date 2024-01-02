import robotjs from 'robotjs';
import { execSync } from 'child_process';

const hpBarColors = ['783d40', 'd34f4f', 'db4f4f', 'c24a4a', '642e31'];
const manaBarColors = ['3d3d7d', '524fd3', '5350da', '4d4ac2', '2d2d69'];

let windowGeometryCache = null;

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

const calculateBounds = (windowGeometry) => {
  // Calculate bounds for searching
  const startX = windowGeometry.x + windowGeometry.width - 154;
  const endX = windowGeometry.x + windowGeometry.width - 152;
  const startY = windowGeometry.y + 124;
  const endY = windowGeometry.y + 125;

  // Return bounds
  return { startX, endX, startY, endY };
};

const calculatePercentage = (barStartPos, barLength, colors) => {
  let start = barStartPos.x;
  let end = barStartPos.x + barLength;
  let mid;

  while (start < end) {
    mid = Math.floor((start + end) / 2);
    const color = robotjs.getPixelColor(mid, barStartPos.y);

    if (colors.includes(color)) {
      start = mid + 1;
    } else {
      end = mid;
    }

    // Break the loop if the desired color is not found within the specified range
    if (start > end) {
      break;
    }
  }

  return Math.floor(((start - barStartPos.x) / barLength) * 100);
};

const findBars = (bounds) => {
  let healthBarStartPos = null;
  let manaBarStartPos = null;
  let healthPercentage = 0;
  let manaPercentage = 0;

  // Iterate over pixels in bounds
  for (let x = bounds.endX; x >= bounds.startX; x -= 1) {
    for (let y = bounds.startY; y <= bounds.endY; y += 1) {
      // Get color of current pixel
      const color = robotjs.getPixelColor(x, y);

      // Check if color matches health bar color
      if (color === hpBarColors[0] || color === hpBarColors[1]) {
        // Found health bar, save position and break loop
        healthBarStartPos = { x: x - 1, y };
        break;
      }
    }

    // Check if color matches mana bar color
    if (healthBarStartPos !== null) {
      const color = robotjs.getPixelColor(healthBarStartPos.x, healthBarStartPos.y + 13);
      if (color === manaBarColors[0] || color === manaBarColors[1]) {
        manaBarStartPos = { x: healthBarStartPos.x, y: healthBarStartPos.y + 13 };
      }
    }

    // Break outer loop if both bars were found
    if (healthBarStartPos !== null && manaBarStartPos !== null) {
      break;
    }
  }

  // Calculate percentages using new function
  if (healthBarStartPos !== null) {
    healthPercentage = calculatePercentage(healthBarStartPos, 92, hpBarColors);
  }
  if (manaBarStartPos !== null) {
    manaPercentage = calculatePercentage(manaBarStartPos, 92, manaBarColors);
  }

  // Return health bar and mana bar start positions and percentages
  return { healthBarStartPos, manaBarStartPos, healthPercentage, manaPercentage };
};

process.on('message', (message) => {
  const { windowId } = message;
  const windowGeometry = getWindowGeometry(windowId);
  const bounds = calculateBounds(windowGeometry);

  console.time('Execution Time');
  const bars = findBars(bounds);
  console.timeEnd('Execution Time');

  setInterval(() => {
    console.time('Percentage Check Time');
    const newHealthPercentage = calculatePercentage(bars.healthBarStartPos, 92, hpBarColors);
    const newManaPercentage = calculatePercentage(bars.manaBarStartPos, 92, manaBarColors);
    console.timeEnd('Percentage Check Time');

    // Dispatch the actions
    process.send({ type: 'gameState/setHpPercentage', payload: newHealthPercentage });
    process.send({ type: 'gameState/setManaPercentage', payload: newManaPercentage });

    console.log(`Health Bar Percentage: ${newHealthPercentage}%`);
    console.log(`Mana Bar Percentage: ${newManaPercentage}%`);
  }, 50);
});

process.on('SIGINT', () => {
  process.exit();
});
