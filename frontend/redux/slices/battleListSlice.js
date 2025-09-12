import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  entries: [], // Array of battle list entry objects
  lastSeenMs: null,
};

const battleListSlice = createSlice({
  name: 'battleList',
  initialState,
  reducers: {
    /**
     * Sets the entire battle list entries array.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {Array<object>} action.payload - An array of battle list entry objects.
     */
    setBattleListEntries: (state, action) => {
      state.entries = action.payload;
      if (action.payload.length > 0) {
        state.lastSeenMs = Date.now();
      }
    },
    /**
     * Resets the battleList state to its initial empty state.
     */
    resetBattleList: (state) => {
      state.entries = initialState.entries;
    },
    setTargetedCreature: (state, action) => {
      const creatureName = action.payload;
      state.entries.forEach((entry) => {
        entry.isTarget = entry.name === creatureName;
      });
    },
    /**
     * Replaces the entire slice state. Use with caution.
     * @param {object} state - The current state.
     * @param {object} action - The action containing the new state.
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
  setTargetedCreature,
} = battleListSlice.actions;

export default battleListSlice;
