import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: 0,
  manaPercentage: 0,
};

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setPercentages: (state, action) => {
      state.hpPercentage = action.payload.hpPercentage;
      state.manaPercentage = action.payload.manaPercentage;
    },
  },
});

export const { setPercentages } = gameStateSlice.actions;

export default gameStateSlice;
