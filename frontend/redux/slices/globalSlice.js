/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowName: 'Press Alt+W on focused tibia window to attach bot',
  windowId: null,
  display: null, // New: Stores the selected X display string (e.g., ":0", ":2")
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
    setwindowName: (state, action) => {
      state.windowName = action.payload;
    },
    setWindowId: (state, action) => {
      state.windowId = action.payload;
      if (action.payload === null) {
        state.actualFps = 0;
      }
    },
    setDisplay: (state, action) => {
      // New: Reducer to set the display
      state.display = action.payload;
    },
    setWindowName: (state, action) => {
      // New: Reducer to set the window title including character name
      state.windowName = action.payload;
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
        if (!['windowId', 'actualFps', 'display'].includes(key)) {
          // Exclude 'display' from being overwritten by setState
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
  setwindowName,
  setWindowId,
  setDisplay, // Export the new action
  setWindowName, // Export the new action
  setRefreshRate,
  toggleNotifications,
  setState,
  setPreviousSectionStates,
  resetPreviousSectionStates,
} = globalSlice.actions;

export default globalSlice;
