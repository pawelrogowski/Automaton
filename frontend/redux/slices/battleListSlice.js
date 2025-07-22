import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  entries: [], // Array of battle list entry objects
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
    },
    /**
     * Resets the battleList state to its initial empty state.
     */
    resetBattleList: (state) => {
      state.entries = initialState.entries;
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

export const { setBattleListEntries, resetBattleList, setState } =
  battleListSlice.actions;

export default battleListSlice;
