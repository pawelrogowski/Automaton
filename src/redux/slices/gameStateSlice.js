import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: 0,
  manaPercentage: 0,
};

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setHpPercentage: (state, action) => {
      state.hpPercentage = action.payload;
    },
    setManaPercentage: (state, action) => {
      state.manaPercentage = action.payload;
    },
  },
});

export const { setHpPercentage, setManaPercentage } = gameStateSlice.actions;

export default gameStateSlice;
