/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+0 on focused tibia window or Alt+Shift+0 to manually select',
  windowId: null,
  botEnabled: false,
  refreshRate: 25,
  autoLootEnabled: false,
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
      state.refreshRate = action.payload;
    },
    toggleBotEnabled: (state) => {
      if (state.windowId !== null) {
        state.botEnabled = !state.botEnabled;
      }
    },
    toogleAutoLootEnabled: (state) => {
      if (state.windowId !== null) {
        state.autoLootEnabled = !state.autoLootEnabled;
      }
    },
  },
});

export const {
  setWindowTitle,
  setWindowId,
  setIsBotEnabled,
  setRefreshRate,
  toogleAutoLootEnabled,
} = globalSlice.actions;

export default globalSlice;
