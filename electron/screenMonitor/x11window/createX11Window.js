import x11 from 'x11';
import { grabScreen } from '../screenGrabUtils/grabScreen.js';

const windowId = 18874408; // Replace with the actual window ID

grabScreen(windowId)
  .then((imageData) => {
    x11.createClient((err, display) => {
      if (err) throw err;

      const X = display.client;
      const root = display.screen[0].root;
      const depth = display.screen[0].root_depth;

      const wid = X.AllocID();
      X.CreateWindow(
        wid,
        root,
        0,
        0,
        imageData.width,
        imageData.height,
        0,
        depth,
        1, // InputOutput window class
        X.CopyFromParent,
        { backgroundPixel: 0 },
      );
      X.MapWindow(wid);

      const gc = X.AllocID();
      X.CreateGC(gc, wid);

      // Create a pixmap and put the image data into it
      const pixmap = X.AllocID();
      X.CreatePixmap(pixmap, wid, depth, imageData.width, imageData.height);

      // Assuming imageData.data is a Buffer containing raw image data
      X.PutImage(2, pixmap, gc, imageData.width, imageData.height, 0, 0, 0, depth, imageData.data);

      // Copy the pixmap to the window
      X.CopyArea(pixmap, wid, gc, 0, 0, imageData.width, imageData.height, 0, 0);

      // Free resources
      X.FreePixmap(pixmap);

      // Set up an event handler to keep the window open
      X.on('event', (ev) => {
        if (ev.name === 'DestroyNotify') {
          X.terminate();
        }
      });
    });
  })
  .catch((error) => {
    console.error('Error capturing screen:', error);
  });
