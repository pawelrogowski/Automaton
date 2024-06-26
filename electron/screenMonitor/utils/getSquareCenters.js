// Import the slurpArea function
const { slurpArea } = require('./slurpArea');

// Function to calculate the center coordinates of all squares and the 9 squares in the middle
export const getSquareCenters = () => {
  try {
    const slurpOutput = slurpArea();
    const { width, height } = slurpOutput;

    // Calculate the size of each square
    const squareSizeX = width / 15;
    const squareSizeY = height / 11;
    const centerIndices = [
      [6, 4],
      [6, 5],
      [6, 6],
      [7, 4],
      [7, 5],
      [7, 6],
      [8, 4],
      [8, 5],
      [8, 6],
    ];
    let allSquares = [];
    let middleSquares = [];

    for (let i = 0; i < 15; i++) {
      for (let j = 0; j < 11; j++) {
        const centerX = Math.round(slurpOutput.startCoord.x + squareSizeX * i + squareSizeX / 2);
        const centerY = Math.round(slurpOutput.startCoord.y + squareSizeY * j + squareSizeY / 2);

        allSquares.push({ x: centerX, y: centerY });

        if (centerIndices.some(([ci, cj]) => ci === i && cj === j)) {
          middleSquares.push({ x: centerX, y: centerY });
        }
      }
    }
    return { allSquareCenters: allSquares, middleSquareCenters: middleSquares };
  } catch (error) {
    console.error(`Error calculating square centers: ${error.message}`);
    throw error;
  }
};

// Example usage
getSquareCenters();
