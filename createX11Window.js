var x11 = require('x11');

// Function to create a new X11 window and log left mouse click coordinates
function createNewWindow() {
  return new Promise((resolve, reject) => {
    x11.createClient(
      {
        debug: true, // Enable debug output
      },
      function (err, display) {
        if (err) {
          reject(err);
          return;
        }

        const X = display.client;
        const root = display.screen[0].root;

        // Create a new window
        const wid = X.AllocID();
        console.log('new window ID:', wid);
        X.CreateWindow(
          wid,
          root,
          0,
          0,
          500,
          500,
          0,
          X.CopyFromParent,
          X.InputOutput,
          X.CopyFromParent,
          {
            backgroundPixel: 0xffffff, // White background
          },
        );

        // Map the window to make it visible
        X.MapWindow(wid);

        // Select for ButtonPress events
        X.ChangeWindowAttributes(wid, {
          eventMask: x11.eventMask.ButtonPress,
        });

        // Event listener for ButtonPress events
        X.on('event', function (ev) {
          if (ev.name === 'ButtonPress') {
            // Left mouse button
            console.log(`Left mouse click at (${ev.x}, ${ev.y})`, ev);
          }
        });

        console.log('Window created successfully.');
        resolve();
      },
    );
  });
}

// Usage
createNewWindow()
  .then(() => {
    console.log('Window created.');
  })
  .catch((error) => {
    console.error('Error creating window:', error);
  });
