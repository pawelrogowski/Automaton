/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+W on focused tibia window to attach bot',
  windowId: null,
  isBotEnabled: false,
  refreshRate: 32,
  notificationsEnabled: true,
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
    setIsisBotEnabled: (state, action) => {
      state.isBotEnabled = action.payload;
    },
    setRefreshRate: (state, action) => {
      state.refreshRate = Math.max(action.payload, 0);
    },
    toggleNotifications: (state) => {
      state.notificationsEnabled = !state.notificationsEnabled;
    },
    toggleisBotEnabled: (state) => {
      state.isBotEnabled = !state.isBotEnabled;
    },
    setState: (state, action) => {
      const newState = { ...state };

      Object.keys(newState).forEach((key) => {
        if (!['windowId', 'isBotEnabled', 'actualFps'].includes(key)) {
          newState[key] = action.payload[key];
        }
      });

      return newState;
    },
  },


});

export const {
  setWindowTitle,
  setWindowId,
  setIsisBotEnabled,
  setRefreshRate,
  toggleNotifications,
  toggleisBotEnabled,
  setState,
} = globalSlice.actions;

export default globalSlice;
