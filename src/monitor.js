const robotjs = require('robotjs');
const exec = require('child_process').exec;

process.on('message', (rule) => {
  setInterval(() => {
    rule.colors.forEach((color) => {
      try {
        if (color.enabled) {
          const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
          if (pixelColor === color.color) {
            exec(`xdotool key ${rule.key}`);
          }
        }
      } catch (error) {
        process.send({ error });
      }
    });
  }, rule.interval);
});
