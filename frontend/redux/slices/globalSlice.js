/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+W on focused tibia window to attach bot',
  streamerMode: true,
  windowId: null,
  windowPos: { x: 0, y: 0 },
  botEnabled: false,
  refreshRate: 20,
  notificationsEnabled: true,
  activePresetIndex: 0,
  actualFps: 0,
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
    setIsBotEnabled: (state, action) => {
      state.botEnabled = action.payload;
    },
    setRefreshRate: (state, action) => {
      state.refreshRate = Math.max(action.payload, 0);
    },
    toggleNotifications: (state) => {
      state.notificationsEnabled = !state.notificationsEnabled;
    },
    toggleBotEnabled: (state) => {
      state.botEnabled = !state.botEnabled;
    },
    setActivePresetIndex: (state, action) => {
      state.activePresetIndex = action.payload;
    },
    setActualFps: (state, action) => {
      state.actualFps = action.payload;
    },
    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        if (!['windowId', 'windowPos', 'botEnabled', 'actualFps'].includes(key)) {
          newState[key] = action.payload[key];
        }
      });

      return newState;
    },
  },

  setWindowPos: (state, action) => {
    state.windowPos = action.payload;
  },
});

export const {
  setWindowTitle,
  setWindowId,
  setIsBotEnabled,
  setRefreshRate,
  setWindowPos,
  toggleNotifications,
  toggleBotEnabled,
  setState,
  setActivePresetIndex,
  setActualFps,
} = globalSlice.actions;

export default globalSlice;
