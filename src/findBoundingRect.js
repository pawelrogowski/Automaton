const robotjs = require('robotjs');
const exec = require('child_process').exec;

const barLength = 85; // Set the length of the bar here
const topColor = '#454646'; // Set the color of the topmost pixel here
const bottomColor = '#474847'; // Set the color of the bottommost pixel here

process.on('message', (rule) => {
  const intervalFunction = () => {
    rule.colors.forEach((color) => {
      try {
        if (color.enabled) {
          let leftmost = color.x - Math.floor(barLength / 2);
          let rightmost = leftmost + barLength - 1;

          const startTime = Date.now();

          while (rightmost - leftmost + 1 === barLength) {
            const leftColor = `#${robotjs.getPixelColor(leftmost, color.y)}`;
            const rightColor = `#${robotjs.getPixelColor(rightmost, color.y)}`;

            if (leftColor === color.color && rightColor === color.color) {
              break;
            }

            if (leftColor !== color.color) {
              leftmost++;
            }

            if (rightColor !== color.color) {
              rightmost--;
            }
          }

          const endTime = Date.now();
          const elapsedTime = endTime - startTime;

          const screenHeight = robotjs.getScreenSize().height;
          let topmost = 0;
          let bottommost = screenHeight - 1;

          while (topmost < bottommost) {
            const topPixelColor = `#${robotjs.getPixelColor(color.x, topmost)}`;
            const bottomPixelColor = `#${robotjs.getPixelColor(color.x, bottommost)}`;

            if (topPixelColor !== topColor) {
              topmost++;
            }

            if (bottomPixelColor !== bottomColor) {
              bottommost--;
            }

            if (topPixelColor === topColor && bottomPixelColor === bottomColor) {
              break;
            }
          }

          console.log(
            `Bounding rectangle: left=${leftmost}, right=${rightmost}, top=${topmost}, bottom=${bottommost}`,
          );
          console.log(`Time taken: ${elapsedTime} ms`);

          const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
          if (pixelColor === color.color) {
            exec(`xdotool key ${rule.key}`);
          }
        }
      } catch (error) {
        process.send({ error });
      }
    });
    setTimeout(intervalFunction, rule.interval);
  };
  intervalFunction();
});
