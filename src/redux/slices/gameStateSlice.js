import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: null,
  manaPercentage: null,
  isVisible: false,
  healingCdActive: false,
  supportCdActive: false,
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
    setHealingCdActive: (state, action) => {
      state.healingCdActive = action.payload.HealingCdActive;
    },
    setSupportCdActive: (state, action) => {
      state.supportCdActive = action.payload.supportCdActive;
    },
  },
});

export const { setHealthPercent, setManaPercent, setHealingCdActive } = gameStateSlice.actions;

export default gameStateSlice;
