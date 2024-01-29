import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: null,
  manaPercentage: null,
  isVisible: false,
  healingCdActive: false,
  supportCdActive: false,
  characterStatus: {
    agony: false,
    bleeding: false,
    bakragoresTaints: false,
    burning: false,
    cursed: false,
    dazzled: false,
    drowning: false,
    drunk: false,
    electrified: false,
    feared: false,
    freezing: false,
    goshnarsTaints: false,
    hasted: false,
    hexed: false,
    hungry: false,
    logoutBlock: false,
    magicShield: false,
    eRing: false,
    poisoned: false,
    protectionZoneBlock: false,
    rooted: false,
    paralyzed: false,
    strenghted: false,
    inProtectedZone: false,
    inRestingArea: false,
    battleSign: false,
  },
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
    setCharacterStatus: (state, action) => {
      const { characterStatus } = action.payload || {};
      // eslint-disable-next-line no-restricted-syntax
      for (const key in characterStatus) {
        if (characterStatus.hasOwnProperty(key)) {
          state.characterStatus[key] = characterStatus[key];
        }
      }
    },
  },
});

export const { setHealthPercent, setManaPercent, setHealingCdActive, setCharacterStatus } =
  gameStateSlice.actions;

export default gameStateSlice;
