// electron/workers/sabState/index.js
// Main export for unified SAB state management

import { SABState } from './SABState.js';
import { ControlChannel } from './controlChannel.js';

export { SABState, ControlChannel };
export {
  SCHEMA,
  LAYOUT,
  TOTAL_SAB_SIZE,
  PROPERTY_CATEGORIES,
  FIELD_TYPES,
  WORKER_IDS,
  CONTROL_COMMANDS,
  CONTROL_PRIORITIES,
  CONTROL_STATES,
  getPropertyInfo,
  getPropertiesByCategory,
} from './schema.js';

/**
 * Create a worker-side SAB state interface
 * @param {SharedArrayBuffer} sab - The unified SAB from workerManager
 * @param {number} workerId - WORKER_IDS constant
 * @returns {Object} Worker interface with state and controlChannel
 */
export const createWorkerInterface = (sab, workerId) => {
  const state = new SABState(sab);
  const controlChannel = new ControlChannel(state.array);
  controlChannel.setWorkerId(workerId);
  
  return {
    state,
    controlChannel,
    // Convenience methods
    get: (prop) => state.get(prop),
    set: (prop, val) => state.set(prop, val),
    batch: (updates) => state.batch(updates),
    snapshot: (props) => state.snapshot(props),
    watch: (prop, cb) => state.watch(prop, cb),
    getVersion: (prop) => state.getVersion(prop),
    // Control channel methods
    sendMessage: (target, cmd, payload, priority) => 
      controlChannel.send(target, cmd, payload, priority),
    pollMessages: () => controlChannel.poll(),
    waitForMessage: (timeout) => controlChannel.waitForMessage(timeout),
    broadcast: (cmd, payload, priority) => 
      controlChannel.broadcast(cmd, payload, priority),
  };
};
