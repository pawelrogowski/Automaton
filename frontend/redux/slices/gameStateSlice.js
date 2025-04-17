import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: null,
  manaPercentage: null,
  isVisible: false,
  healingCdActive: false,
  supportCdActive: false,
  attackCdActive: false,
  monsterNum: 0,
  partyNum: 0,
  characterStatus: {
    bleeding: false,
    burning: false,
    cursed: false,
    dazzled: false,
    drowning: false,
    drunk: false,
    electrified: false,
    freezing: false,
    hasted: false,
    hexed: false,
    hungry: false,
    battleSign: false,
    magicShield: false,
    eRing: false,
    poisoned: false,
    redBattleSign: false,
    paralyzed: false,
    strengthened: false,
    inProtectedZone: false,
    inRestingArea: false,
    whiteSkull: false,
    redSkull: false,
  },
};

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setHealthPercent: (state, action) => {
      const newHpPercentage = action.payload.hpPercentage;
      const currentTime = Date.now();
      state.hpPercentage = newHpPercentage;
    },
    setManaPercent: (state, action) => {
      const newManaPercentage = action.payload.manaPercentage;
      const currentTime = Date.now();

      state.manaPercentage = newManaPercentage;
    },
    setHealingCdActive: (state, action) => {
      state.healingCdActive = action.payload.HealingCdActive;
    },
    setSupportCdActive: (state, action) => {
      state.supportCdActive = action.payload.supportCdActive;
    },
    setAttackCdActive: (state, action) => {
      state.attackCdActive = action.payload.attackCdActive;
    },
    setCharacterStatus: (state, action) => {
      const { characterStatus } = action.payload || {};
      for (const key in characterStatus) {
        if (characterStatus.hasOwnProperty(key)) {
          state.characterStatus[key] = characterStatus[key];
        }
      }
    },
    setMonsterNum: (state, action) => {
      const newMonsterNum = action.payload.monsterNum;
      state.monsterNum = newMonsterNum;
    },
    setPartyNum: (state, action) => {
      const newPartyNum = action.payload.partyNum;
      state.partyNum = newPartyNum;
    },
    setState: (state, action) => {
      return action.payload;
    },
  },
});

export const { setHealthPercent, setManaPercent, setHealingCdActive, setCharacterStatus, setMonsterNum, setPartyNum, setState } =
  gameStateSlice.actions;

export default gameStateSlice;
