import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: 0,
  manaPercentage: 0,
};

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setHealthPercent: (state, action) => {
      state.hpPercentage = action.payload.hpPercentage;
    },
    setManaPercent: (state, action) => {
      state.manaPercentage = action.payload.manaPercentage;
    },
  },
});

export const { setHealthPercent, setManaPercent } = gameStateSlice.actions;

export default gameStateSlice;
