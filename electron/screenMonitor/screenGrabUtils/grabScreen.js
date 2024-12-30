import ScreenGrabber from './screenGrabber.js';

const grabberInstance = new ScreenGrabber(
  '/home/feiron/Dokumenty/Automaton/resources/grabImage/grab_image',
);

async function grabScreen(windowId, region = {}) {
  return grabberInstance.grab(windowId, region);
}

// Clean up when the app exits
process.on('exit', () => {
  grabberInstance.cleanup();
});
process.on('SIGINT', () => {
  grabberInstance.cleanup();
  process.exit();
});

export { grabScreen };
