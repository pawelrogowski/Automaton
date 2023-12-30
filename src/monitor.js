const robotjs = require('robotjs');
const exec = require('child_process').exec;

process.on('message', (rule) => {
  setInterval(() => {
    const allConditionsMet = rule.colors.every((color) => {
      const pixelColor = `#${robotjs.getPixelColor(color.x, color.y)}`;
      return color.enabled ? pixelColor === color.color : pixelColor !== color.color;
    });

    if (allConditionsMet) {
      exec(`xdotool key --window ${rule.windowId} ${rule.key}`);
    }
  }, rule.interval);
});
