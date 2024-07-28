import x11 from 'x11';
import { grabScreen } from './grabScreen.js';
import createX11Client from './createX11Client.js';

async function displaySyncedWindow(sourceWindowId) {
  try {
    const { X, display } = await createX11Client();
    console.log('X11 client created');

    const root = display.screen[0].root;
    console.log('Root window ID:', root);

    // Get the geometry of the source window
    const sourceGeom = await new Promise((resolve, reject) => {
      X.GetGeometry(sourceWindowId, (err, geom) => {
        if (err) {
          reject(new Error(`Cannot access window ${sourceWindowId}: ${err.message}`));
        } else {
          resolve(geom);
        }
      });
    });
    console.log('Source window geometry:', sourceGeom);

    // Create a new window
    const newWindowId = X.AllocID();
    X.CreateWindow(
      newWindowId,
      root,
      0,
      0,
      sourceGeom.width,
      sourceGeom.height,
      0,
      sourceGeom.depth,
      1, // InputOutput
      0, // CopyFromParent
      {
        eventMask: x11.eventMask.Exposure | x11.eventMask.StructureNotify,
        backgroundPixel: display.screen[0].white_pixel,
      },
    );
    X.MapWindow(newWindowId);
    console.log('New window created with ID:', newWindowId);

    // Create a GC for drawing
    const gc = X.AllocID();
    X.CreateGC(gc, newWindowId);

    // Function to update the window
    async function updateWindow() {
      try {
        const imageData = await grabScreen(sourceWindowId);
        console.log('Grabbed image data:', {
          length: imageData.length,
          byteLength: imageData.byteLength,
          bytesPerElement: imageData.BYTES_PER_ELEMENT,
        });

        const bytesPerPixel = 4; // Assuming 32-bit RGBA
        const expectedTotalBytes = sourceGeom.width * sourceGeom.height * bytesPerPixel;
        console.log('Window dimensions:', sourceGeom.width, 'x', sourceGeom.height);
        console.log('Window depth:', sourceGeom.depth);
        console.log('Bytes per pixel:', bytesPerPixel);
        console.log('Expected total bytes:', expectedTotalBytes);

        if (imageData.byteLength !== expectedTotalBytes) {
          console.warn(
            `Warning: Image data size (${imageData.byteLength}) doesn't match expected size (${expectedTotalBytes})`,
          );
        }

        // Create a buffer with the correct size
        const buffer = Buffer.from(imageData.buffer, imageData.byteOffset, imageData.byteLength);
        console.log('Created buffer with size:', buffer.length);

        // Calculate the correct length for the PutImage request
        const dataLength = buffer.length;
        const requestLength = (6 + (dataLength + 3)) >> 2;

        console.log('PutImage parameters:', {
          width: sourceGeom.width,
          height: sourceGeom.height,
          depth: 32, // Using 32-bit depth
          dataLength,
          requestLength,
          bufferLength: buffer.length,
        });

        // Put the image into the new window
        X.PutImage(
          2, // ZPixmap
          newWindowId,
          gc,
          sourceGeom.width,
          sourceGeom.height,
          0,
          0,
          0, // Left pad
          32, // Use 32-bit depth for the output
          buffer,
        );

        console.log('PutImage call completed');
      } catch (error) {
        console.error('Error updating window:', error);
      }
    }
    // Set up a loop to update the window periodically
    const intervalId = setInterval(updateWindow, 1000); // Increased interval for debugging

    // Handle events
    X.on('event', (ev) => {
      if (ev.name === 'Expose' && ev.wid === newWindowId) {
        updateWindow();
      } else if (ev.name === 'DestroyNotify' && ev.wid === newWindowId) {
        clearInterval(intervalId);
        X.terminate();
      }
    });

    // Handle errors
    X.on('error', (err) => {
      console.error('X11 error:', err);
    });

    console.log('Window sync started');
  } catch (error) {
    console.error('Error in displaySyncedWindow:', error);
  }
}

const sourceWindowId = 41943066; // Replace with your source window ID
displaySyncedWindow(sourceWindowId);
