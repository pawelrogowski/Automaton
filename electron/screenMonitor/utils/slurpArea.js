const { execSync } = require('child_process');

export const slurpArea = () => {
  try {
    const stdout = execSync('slurp').toString();
    const match = stdout.match(/(\d+,\d+)\s+(\d+x\d+)/);
    if (!match) {
      throw new Error('Invalid slurp output');
    }

    // Extracting the top-left coordinates and size
    const startCoord = { x: Number(match[1].split(',')[0]), y: Number(match[1].split(',')[1]) };
    const sizeParts = match[2].split('x');
    const width = Number(sizeParts[0]);
    const height = Number(sizeParts[1]);

    // Calculating the bottom-right coordinates
    const endCoord = { x: startCoord.x + width, y: startCoord.y + height };

    console.log({
      startCoord: startCoord,
      endCoord: endCoord,
      width,
      height,
    });

    return {
      startCoord: startCoord,
      endCoord: endCoord,
      width,
      height,
    };
  } catch (error) {
    console.error(`Error executing slurp: ${error.message}`);
    throw error;
  }
};
