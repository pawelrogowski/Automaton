import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  hpPercentage: null,
  manaPercentage: null,
  hpPercentageDrops: [],
  manaPercentageDrops: [],
  averageHpDropPerSecond: 0,
  averageManaDropPerSecond: 0,
  biggestHpDrop: 0,
  isVisible: false,
  healingCdActive: false,
  supportCdActive: false,
  attackCdActive: false,
  monsterNum: 0,
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

      // Only calculate the drop if the new percentage is less than the current percentage
      if (newHpPercentage < state.hpPercentage) {
        // Calculate the HP% drop
        const hpDrop = state.hpPercentage - newHpPercentage;

        // Update the HP% drop array
        state.hpPercentageDrops.push({ time: currentTime, drop: hpDrop });

        // Filter out drops that are older than 6 seconds
        state.hpPercentageDrops = state.hpPercentageDrops.filter(
          (drop) => currentTime - drop.time <= 60000,
        );

        // Calculate the average HP% drop per second
        const totalHpDrop = state.hpPercentageDrops.reduce((sum, drop) => sum + drop.drop, 0);
        const hpSeconds = (currentTime - state.hpPercentageDrops[0].time) / 1000;
        state.averageHpDropPerSecond = hpSeconds > 0 ? totalHpDrop / hpSeconds : 0;

        // Update the biggest HP% drop if the current drop is larger
        if (hpDrop > state.biggestHpDrop) {
          state.biggestHpDrop = hpDrop;
        }

        // Log the updated average HP% drop per second and the biggest drop
        console.log(`Updated average HP% drop per second: ${state.averageHpDropPerSecond}`);
        console.log(`Biggest HP% drop: ${state.biggestHpDrop}`);
      }

      // Update the HP%
      state.hpPercentage = newHpPercentage;
    },
    setManaPercent: (state, action) => {
      const newManaPercentage = action.payload.manaPercentage;
      const currentTime = Date.now();

      // Only calculate the drop if the new percentage is less than the current percentage
      if (newManaPercentage < state.manaPercentage) {
        // Calculate the Mana% drop
        const manaDrop = state.manaPercentage - newManaPercentage;

        // Update the Mana% drop array
        state.manaPercentageDrops.push({ time: currentTime, drop: manaDrop });

        // Filter out drops that are older than 6 seconds
        state.manaPercentageDrops = state.manaPercentageDrops.filter(
          (drop) => currentTime - drop.time <= 100000,
        );

        // Calculate the average Mana% drop per second
        const totalManaDrop = state.manaPercentageDrops.reduce((sum, drop) => sum + drop.drop, 0);
        const manaSeconds = (currentTime - state.manaPercentageDrops[0].time) / 1000;
        state.averageManaDropPerSecond = manaSeconds > 0 ? totalManaDrop / manaSeconds : 0;
        // console.log(state.averageManaDropPerSecond);
      }

      // Update the Mana%
      state.manaPercentage = newManaPercentage;
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
    setAttackCdActive: (state, action) => {
      state.attackCdActive = action.payload.attackCdActive;
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
    setMonsterNum: (state, action) => {
      const newMonsterNum = action.payload.monsterNum;
      state.monsterNum = newMonsterNum;
    },
  },
});

export const {
  setHealthPercent,
  setManaPercent,
  setHealingCdActive,
  setCharacterStatus,
  setMonsterNum,
} = gameStateSlice.actions;

export default gameStateSlice;
