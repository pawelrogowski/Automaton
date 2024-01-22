import x11 from 'x11';

// Create an X11 client
x11
  .createClient((err, display) => {
    if (err) {
      console.error('Error connecting to X server:', err);
      process.exit(1);
    }

    console.log('Connected to X server');
    const X = display.client;
    const root = display.screen[0].root;

    // Function to find a window with a specific ID
    function findWindowById(windowId, targetId, callback) {
      X.QueryTree(windowId, (err, tree) => {
        if (err) {
          console.error('Error querying tree:', err);
          return;
        }

        // Check if this window is the one we're looking for
        if (windowId === targetId) {
          callback(windowId);
          return;
        }

        // Recursively call findWindowById for each child window
        tree.children.forEach((childWindowId) => {
          findWindowById(childWindowId, targetId, callback);
        });
      });
    }

    // Usage:
    const targetId = 102760474; // Replace with the ID you're looking for
    findWindowById(root, targetId, (foundWindowId) => {
      console.log(`Found window with ID: ${foundWindowId}`);

      // Get the geometry of the window
      X.GetGeometry(foundWindowId, (err, geom) => {
        if (err) {
          console.error('Error getting window geometry:', err);
          return;
        }

        // Capture the image of the window
        X.GetImage(2, foundWindowId, 0, 0, geom.width, geom.height, 0xfffff, (err, image) => {
          if (err) {
            console.error('Error capturing image:', err);
            return;
          }

          // Log the length of the image data
          console.log(`Length of image data: ${image.data.length}`);
          X.terminate(); // Close the connection to the X server
        });
      });
    });
  })
  .on('error', (err) => {
    console.error('Error connecting to X server:', err);
  });
