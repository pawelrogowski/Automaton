/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: 'Press Alt+0 on focused tibia window or Alt+Shift+0 to manually select',
  windowId: null,
  windowPos: { x: 0, y: 0 },
  botEnabled: false,
  refreshRate: 0,
  autoLootEnabled: false,
  antiIdleEnabled: true,
  squareTopLeft: { x: 0, y: 0 },
  squareBottomRight: { x: 0, y: 0 },
  centerSquare: { x: 0, y: 0 },
};

function calculateCenterSquare(state) {
  // Calculate the size of each square
  const squareWidth = (state.squareBottomRight.x - state.squareTopLeft.x) / 15;
  const squareHeight = (state.squareBottomRight.y - state.squareTopLeft.y) / 11;
  console.log(squareWidth, squareHeight);
  // Calculate the coordinates of the central square
  const centerX = state.squareTopLeft.x + squareWidth * 7; // 7th column for 15x11 grid
  const centerY = state.squareTopLeft.y + squareHeight * 5; // 5th row for 15x11 grid

  state.centerSquare = { x: centerX, y: centerY };
  console.log({ x: centerX, y: centerY });
}

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
    setSquareTopLeft: (state, action) => {
      state.squareTopLeft = action.payload;
      // Ensure calculations are done only if both topLeft and bottomRight are defined
      if (state.squareBottomRight.x !== 0 && state.squareBottomRight.y !== 0) {
        calculateCenterSquare(state);
      }
    },
    setSquareBottomRight: (state, action) => {
      state.squareBottomRight = action.payload;
      // Ensure calculations are done only if both topLeft and bottomRight are defined
      if (state.squareTopLeft.x !== 0 && state.squareTopLeft.y !== 0) {
        calculateCenterSquare(state);
      }
    },
    toggleAntiIdleEnabled: (state) => {
      state.antiIdleEnabled = !state.antiIdleEnabled;
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
  toogleAutoLootEnabled,
  setWindowPos,
  setSquareTopLeft,
  setSquareBottomRight,
  toggleAntiIdleEnabled,
} = globalSlice.actions;

export default globalSlice;
