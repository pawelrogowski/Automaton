const { keyboard, Key, Point, screen } = require('@nut-tree/nut-js');
const { rgbaToHex } = require('./utils/rgbaToHex.js');

process.on('message', (rule) => {
  const points = rule.colors.map((color) => new Point(color.x, color.y));
  console.log(points);
  setInterval(async () => {
    await Promise.all(
      rule.colors.map(async (color, index) => {
        try {
          if (color.enabled) {
            const pixelColor = await screen.colorAt(points[index]);
            const screenColor = rgbaToHex(pixelColor);
            if (screenColor === color.color) {
              keyboard.type(Key[rule.key.toUpperCase()]);
            }
          }
        } catch (error) {
          process.send({ error });
        }
      }),
    );
  }, rule.interval);
});
