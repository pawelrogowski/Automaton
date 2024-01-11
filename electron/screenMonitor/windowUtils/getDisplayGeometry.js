import * as X11 from 'x11';

const getDisplayGeometry = async () => {
  return new Promise((resolve, reject) => {
    X11.createClient((err, display) => {
      if (err) {
        reject(err);
        return;
      }

      const screen = display.screen[0];
      const displayGeometry = {
        width: screen.pixel_width,
        height: screen.pixel_height,
      };

      resolve(displayGeometry);
    });
  });
};

export default getDisplayGeometry;
