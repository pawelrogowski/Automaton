/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+W on focused tibia window or Alt+Shift+W to manually select',
  windowId: null,
  botEnabled: false,
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
    toggleBotEnabled: (state) => {
      if (state.windowId !== null) {
        state.botEnabled = !state.botEnabled;
      }
    },
  },
});

export const { setWindowTitle, setWindowId, setIsBotEnabled } = globalSlice.actions;

export default globalSlice;
