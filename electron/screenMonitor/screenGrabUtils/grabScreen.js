import ScreenGrabber from './screenGrabber.js';

const grabberInstance = new ScreenGrabber(
  '/home/feiron/Dokumenty/Automaton/resources/grabImage/grab_image',
);

async function grabScreen(windowId, region = {}) {
  return grabberInstance.grab(windowId, region);
}

// Clean up when the app exits
process.on('exit', () => {
  grabberInstance.terminate();
});
process.on('SIGINT', () => {
  grabberInstance.terminate();
  process.exit();
});

export { grabScreen };
