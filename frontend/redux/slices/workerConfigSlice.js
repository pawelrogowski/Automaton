import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,
  creatureMonitor: {
    PLAYER_ANIMATION_FREEZE_MS: 25,
    STICKY_SNAP_THRESHOLD_TILES: 0.5,
    JITTER_CONFIRMATION_TIME_MS: 75,
    CORRELATION_DISTANCE_THRESHOLD_PIXELS: 200,
    CREATURE_GRACE_PERIOD_MS: 250,
    UNMATCHED_BLACKLIST_MS: 500,
    NAME_MATCH_THRESHOLD: 0.4,
  },
  targetingWorker: {
    mainLoopIntervalMs: 50,
    unreachableTimeoutMs: 250,
    clickThrottleMs: 250,
    verifyWindowMs: 300,
    antiStuckAdjacentMs: 5000,
  },
};

const workerConfigSlice = createSlice({
  name: 'workerConfig',
  initialState,
  reducers: {
    setCreatureMonitorConfig: (state, action) => {
      state.creatureMonitor = { ...state.creatureMonitor, ...action.payload };
      state.version = (state.version || 0) + 1;
    },
    setTargetingWorkerConfig: (state, action) => {
      state.targetingWorker = {
        ...state.targetingWorker,
        ...action.payload,
      };
      state.version = (state.version || 0) + 1;
    },
    setCreatureMonitorConfigValue: (state, action) => {
      const { key, value } = action.payload;
      if (state.creatureMonitor.hasOwnProperty(key)) {
        state.creatureMonitor[key] = value;
        state.version = (state.version || 0) + 1;
      }
    },
    setTargetingWorkerConfigValue: (state, action) => {
      const { key, value } = action.payload;
      if (state.targetingWorker.hasOwnProperty(key)) {
        state.targetingWorker[key] = value;
        state.version = (state.version || 0) + 1;
      }
    },
    resetCreatureMonitorConfig: (state) => {
      state.creatureMonitor = initialState.creatureMonitor;
      state.version = (state.version || 0) + 1;
    },
    resetTargetingWorkerConfig: (state) => {
      state.targetingWorker = initialState.targetingWorker;
      state.version = (state.version || 0) + 1;
    },
    setState: (state, action) => {
      return { ...action.payload, version: (state.version || 0) + 1 };
    },
  },
});

export const {
  setCreatureMonitorConfig,
  setTargetingWorkerConfig,
  setCreatureMonitorConfigValue,
  setTargetingWorkerConfigValue,
  resetCreatureMonitorConfig,
  resetTargetingWorkerConfig,
  setState,
} = workerConfigSlice.actions;

export default workerConfigSlice;
