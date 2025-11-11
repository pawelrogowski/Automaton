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
 * - getVersion(prop): Read only the version counter (lightweight)
 * - getMany(props): Read multiple properties with consistency guarantee
 * - setMany(updates): Write multiple properties atomically
 *
 * @param {SharedArrayBuffer} sab - The unified SAB from workerManager
 * @param {number} workerId - WORKER_IDS constant (unused, kept for compatibility)
 * @returns {Object} Worker interface with SAB methods
 */
export const createWorkerInterface = (sab, workerId) => {
  const state = new SABState(sab);

  const get = (prop) => state.get(prop);
  const set = (prop, val) => state.set(prop, val);
  const getVersion = (prop) => state.getVersion(prop);
  const getMany = (props) => state.getMany(props);
  const setMany = (updates, options) => state.setMany(updates, options || {});

  /**
   * Read a coherent snapshot for targeting-related decisions.
   * This is a thin helper over getMany to avoid cross-property tearing.
   *
   * Returned shape:
   * {
   *   creatures: Array,
   *   battleList: Array,
   *   target: Object|null,
   *   looting: Object|null,
   *   cavebotPathData: Object|null,
   *   versionsMatch: boolean
   * }
   *
   * Callers must treat versionsMatch === false as "do not make irreversible decisions".
   */
  const getTargetingSnapshot = () => {
    const snapshot = getMany([
      'creatures',
      'battleList',
      'target',
      'looting',
      'cavebotPathData',
    ]);

    // getMany already returns { prop: {data,version}, versionsMatch }
    const {
      creatures,
      battleList,
      target,
      looting,
      cavebotPathData,
      versionsMatch,
    } = snapshot;

    return {
      creatures: (creatures && creatures.data) || [],
      battleList: (battleList && battleList.data) || [],
      target: (target && target.data) || null,
      looting: (looting && looting.data) || null,
      cavebotPathData: (cavebotPathData && cavebotPathData.data) || null,
      versionsMatch: !!versionsMatch,
    };
  };

  return {
    get,
    set,
    getVersion,
    getMany,
    setMany,
    getTargetingSnapshot,
  };
};
