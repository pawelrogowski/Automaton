import { workerData } from 'worker_threads';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const keycoordinates = require(workerData.useItemOnPath);

function useItemOnCoordinates(targetWindowId, targetX, targetY, key) {
  keycoordinates.useKeyOnCoordinates(parseInt(targetWindowId), key, parseInt(targetX), parseInt(targetY));
}
export default useItemOnCoordinates;
