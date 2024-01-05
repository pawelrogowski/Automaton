const robot = require('robotjs');
console.time('capture');
// Define the region to capture (x, y, width, height)

// Define the region to capture (x, y, width, height)
const region = { x: 0, y: 0, width: 3000, height: 1 };

// Capture the screenshot
const screenshot = robot.screen.capture(region.x, region.y, region.width, region.height);
console.log(screenshot);
// Get the color of each pixel

console.log(screenshot.colorAt(84, 0));

console.timeEnd('capture');
