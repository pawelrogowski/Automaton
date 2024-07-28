import createX11Client from './createX11Client.js';

async function listenX11Events(targetWindowId) {
  console.log('Starting listenX11Events function');
  try {
    console.log('Attempting to create X11 client');
    const { X } = await createX11Client();
    console.log('X11 client created successfully');

    console.log(`Listening for events. Target window ID: ${targetWindowId}`);

    // Set up event handler
    X.on('event', (ev) => {
      console.log('Event received for target window:', ev);
    });

    // Keep the script running
    process.on('SIGINT', () => {
      console.log('Stopping event listener');
      X.terminate();
      process.exit();
    });
  } catch (error) {
    console.error('Error in listenX11Events:', error);
  }
}

// Usage example
const windowId = 41943066; // Replace with the actual window ID you want to listen to
console.log(`Starting script with target window ID: ${windowId}`);
listenX11Events(windowId);

export default listenX11Events;
