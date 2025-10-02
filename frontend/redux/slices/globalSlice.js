import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,
  windowName: 'Press Alt+W on focused tibia window to attach bot',
  windowId: null,
  display: null,
  notificationsEnabled: true,
  previousSectionStates: {
    rules: false,
    cavebot: false,
    lua: false,
    targeting: false,
  },
  isGlobalShortcutsEnabled: true,
};

const globalSlice = createSlice({
  name: 'global',
  initialState,
  reducers: {
    setwindowName: (state, action) => {
      state.windowName = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setWindowId: (state, action) => {
      state.windowId = action.payload;
      state.version = (state.version || 0) + 1;
      if (action.payload === null) {
        state.actualFps = 0;
      }
    },
    setDisplay: (state, action) => {
      state.display = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setWindowName: (state, action) => {
      state.windowName = action.payload;
      state.version = (state.version || 0) + 1;
    },
    toggleNotifications: (state) => {
      state.notificationsEnabled = !state.notificationsEnabled;
      state.version = (state.version || 0) + 1;
    },
    setGlobalShortcutsEnabled: (state, action) => {
      state.isGlobalShortcutsEnabled = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        if (!['windowId', 'actualFps', 'display'].includes(key)) {
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
  setDisplay,
  setWindowName,
  toggleNotifications,
  setGlobalShortcutsEnabled,
  setState,
  setPreviousSectionStates,
  resetPreviousSectionStates,
} = globalSlice.actions;

export default globalSlice;
