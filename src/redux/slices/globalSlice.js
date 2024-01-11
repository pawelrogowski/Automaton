/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Pick a window from the bot menu',
  windowId: null,
  healingEnabled: false,
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
    setHealing: (state, action) => {
      state.healingEnabled = action.payload;
    },
  },
});

export const { setWindowTitle, setWindowId, setHealing } = globalSlice.actions;

export default globalSlice;
