// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/battleListSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  entries: [], // Shape: [{ name, x, y }] - No longer tracks 'isTarget'
  lastSeenMs: null,
};

const battleListSlice = createSlice({
  name: 'battleList',
  initialState,
  reducers: {
    /**
     * Sets the entire battle list entries array.
     * @param {Array<object>} action.payload - An array of battle list entry objects.
     */
    setBattleListEntries: (state, action) => {
      state.entries = action.payload;
    },
    updateLastSeenMs: (state) => {
      state.lastSeenMs = Date.now();
    },
    /**
     * Resets the battleList state to its initial empty state.
     */
    resetBattleList: (state) => {
      state.entries = initialState.entries;
    },
    /**
     * Replaces the entire slice state. Use with caution.
     */
    setState: (state, action) => {
      return action.payload;
    },
  },
});

export const {
  setBattleListEntries,
  resetBattleList,
  setState,
  updateLastSeenMs,
} = battleListSlice.actions;

export default battleListSlice;
