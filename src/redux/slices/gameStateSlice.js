import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: null,
  manaPercentage: null,
  isVisible: false,
  isHealingCooldown: false,
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
    setBarVisibility: (state, action) => {
      state.isBarVisible = action.payload.isBarVisible;
    },
    setHealingCooldownVisibility: (state, action) => {
      state.isHealingCooldown = action.payload.isHealingCooldown;
    },
  },
});

export const { setHealthPercent, setManaPercent, setBarVisibility } = gameStateSlice.actions;

export default gameStateSlice;
