const x11 = require('x11');

function monitorHealthBar(region, interval) {
  x11.createClient((err, display) => {
    if (err) {
      console.error(err);
      return;
    }

    const X = display.client;
    const { root } = display.screen[0];

    function takeScreenshot() {
      X.GetImage(
        2,
        root,
        region.x,
        region.y,
        region.width,
        region.height,
        0xffffff,
        X.ZPixmapFormat,
        (er, img) => {
          if (er) {
            console.error(er);
            return;
          }
          // Convert image data to RGB
          const rgbData = [];
          for (let i = 0; i < img.data.length; i += 4) {
            const r = img.data[i + 2];
            const g = img.data[i + 1];
            const b = img.data[i];
            rgbData.push([r, g, b]);
          }
          // Find sequence of colors
          const sequence = [
            [120, 61, 64],
            [211, 79, 79],
            [219, 79, 79],
          ];
          console.log(rgbData.length);
          for (let i = 0; i < rgbData.length - sequence.length; i++) {
            if (sequence.every((color, j) => color.every((val, k) => val === rgbData[i + j][k]))) {
              const y = Math.floor(i / (region.width * 3) + 1);
              const x = (i % (region.width * 3)) / 3 + 1;
              console.log(`Sequence found at pixel (${x}, ${y})`);
              break;
            }
          }
        },
      );
    }

    setInterval(takeScreenshot, interval);
  });
}

let healthRegion = {
  x: 1765,
  y: 151,
  width: 40,
  height: 10,
};

monitorHealthBar(healthRegion, 100);
