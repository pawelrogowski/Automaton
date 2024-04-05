const { exec } = require('child_process');

// Define the coordinates of the first top left and last bottom right squares
const topLeft = { x: 720, y: 437 };
const bottomRight = { x: 849, y: 571 };

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

// Assuming you have the window ID, replace 'YOUR_WINDOW_ID' with the actual ID
const windowId = '33554458';

// Construct the chained xdotool command for the specific window
let xdotoolCommand = `xdotool `;

// Click the outer squares in a clockwise direction
// Top row
squares.slice(0, 3).forEach((square) => {
  xdotoolCommand += `mousemove --sync ${square.x} ${square.y} click --window ${windowId} --delay 70 --repeat 2 3 `;
});

// Right column
squares.slice(2, 5).forEach((square) => {
  xdotoolCommand += `mousemove --sync ${square.x} ${square.y} click --window ${windowId} --delay 70 --repeat 2 3 `;
});

// Bottom row
squares.slice(6, 9).forEach((square) => {
  xdotoolCommand += `mousemove --sync ${square.x} ${square.y} click --window ${windowId} --delay 70 --repeat 2 3 `;
});

// Left column
squares.slice(8, 11).forEach((square) => {
  xdotoolCommand += `mousemove --sync ${square.x} ${square.y} click --window ${windowId} --delay 70 --repeat 2 3 `;
});

// Click the middle square
xdotoolCommand += `mousemove --sync ${squares[4].x} ${squares[4].y} click --window ${windowId} --delay 70 --repeat 2 3 `;

console.log(xdotoolCommand);
exec(xdotoolCommand);
