/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+W on focused tibia window to attach bot',
  windowId: null,
  refreshRate: 32,
  notificationsEnabled: true,
  previousSectionStates: {
    rules: false,
    cavebot: false,
    lua: false,
    targeting: false,
  },
};

const globalSlice = createSlice({
  name: 'global',
  initialState,
  reducers: {
    setWindowTitle: (state, action) => {
      state.windowTitle = action.payload;
    },
    setWindowId: (state, action) => {
      state.windowId = action.payload;
      if (action.payload === null) {
        state.actualFps = 0;
      }
    },
    setRefreshRate: (state, action) => {
      state.refreshRate = Math.max(action.payload, 0);
    },
    toggleNotifications: (state) => {
      state.notificationsEnabled = !state.notificationsEnabled;
    },
    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        if (!['windowId', 'actualFps'].includes(key)) {
          newState[key] = action.payload[key];
        }
      });

      return newState;
    },
    setPreviousSectionStates: (state, action) => {
      state.previousSectionStates = action.payload;
    },
    resetPreviousSectionStates: (state) => {
      state.previousSectionStates = initialState.previousSectionStates;
    },
  },
});

export const {
  setWindowTitle,
  setWindowId,
  setRefreshRate,
  toggleNotifications,
  setState,
  setPreviousSectionStates,
  resetPreviousSectionStates,
} = globalSlice.actions;

export default globalSlice;
