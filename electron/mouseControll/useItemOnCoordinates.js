import { workerData } from 'worker_threads';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const keypress = require(workerData.paths.useItemOn);

function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  keycoordinates.useKeyOnCoordinates(parseInt(targetWindowId), key, parseInt(targetX), parseInt(targetY));
}
export default useItemOnCoordinates;
