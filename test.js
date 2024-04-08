const { exec } = require('child_process');

// Define the coordinates of the first top left and last bottom right squares
const topLeft = { x: 720, y: 342 };
const bottomRight = { x: 849, y: 472 };

// Calculate the size of each square
const squareSize = {
  width: (bottomRight.x - topLeft.x) / 3,
  height: (bottomRight.y - topLeft.y) / 3,
};

// Generate an array of all square coordinates
const squares = [];
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    const squareCenterX = topLeft.x + (i + 0.5) * squareSize.width;
    const squareCenterY = topLeft.y + (j + 0.5) * squareSize.height;
    squares.push({ x: Math.ceil(squareCenterX), y: Math.ceil(squareCenterY) });
  }
}

// Calculate the Euclidean distance between two points
function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Nearest neighbor algorithm to find the shortest path
function nearestNeighbor(squares) {
  const path = [];
  let squaresCopy = [...squares]; // Create a copy of squares array

  // Set the starting point as the middle square
  const middleIndex = 4; // Index of the middle square in a 3x3 grid
  let start = squaresCopy[middleIndex];
  path.push(start);
  squaresCopy.splice(middleIndex, 1);

  while (squaresCopy.length > 0) {
    let minDistance = Infinity;
    let nearest;
    for (const square of squaresCopy) {
      const dist = distance(start, square);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = square;
      }
    }
    path.push(nearest);
    start = nearest;
    squaresCopy.splice(squaresCopy.indexOf(nearest), 1);
  }

  return path;
}

// Get the sorted path
const sortedPath = nearestNeighbor(squares);

// Assuming you have the window ID, replace 'YOUR_WINDOW_ID' with the actual ID
const windowId = '52428826';

// Define the click options
const clickOptions = {
  delay: 135, // Delay in milliseconds between each click
  button: 3, // Mouse button to click (3 for right click)
};

// Function to generate the xdotool command
function generateXdotoolCommand(path, windowId, clickOptions) {
  let command = `xdotool`;
  for (const square of path) {
    command += ` mousemove --sync ${square.x} ${square.y} mousemove --sync ${square.x + 1} ${square.y - 1} mousemove --sync ${square.x + 2} ${square.y + 2} mousemove --sync ${square.x} ${square.y} mousemove --sync ${square.x + 1} ${square.y} mousemove --sync ${square.x - 1} ${square.y} click --delay ${clickOptions.delay} ${clickOptions.button}`;
  }
  return command;
}

// Generate the xdotool command
const xdotoolCommand = generateXdotoolCommand(sortedPath, windowId, clickOptions);
console.log(xdotoolCommand);
setInterval(() => {
  exec(xdotoolCommand);
}, 2000);
