/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+0 on focused tibia window or Alt+Shift+0 to manually select',
  windowId: null,
  windowPos: { x: 0, y: 0 },
  botEnabled: false,
  refreshRate: 25,
  notificationsEnabled: false,
  activePresetIndex: 0,
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
    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        if (!['windowId', 'windowPos', 'botEnabled'].includes(key)) {
          newState[key] = action.payload[key];
        }
      });

      return newState;
    },
  },

  setWindowPos: (state) => {
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
} = globalSlice.actions;

export default globalSlice;
