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
 *
 * Simple polling-based API:
 * - get(prop): Read a single property
 * - set(prop, val): Write a single property
 * - getMany(props): Read multiple properties with consistency guarantee
 * - setMany(updates): Write multiple properties atomically
 *
 * @param {SharedArrayBuffer} sab - The unified SAB from workerManager
 * @param {number} workerId - WORKER_IDS constant (unused, kept for compatibility)
 * @returns {Object} Worker interface with SAB methods
 */
export const createWorkerInterface = (sab, workerId) => {
  const state = new SABState(sab);

  return {
    get: (prop) => state.get(prop),
    set: (prop, val) => state.set(prop, val),
    getMany: (props) => state.getMany(props),
    setMany: (updates) => state.setMany(updates),
  };
};
