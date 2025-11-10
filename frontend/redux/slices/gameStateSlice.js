import { createSlice } from '@reduxjs/toolkit';
import { createLogger } from '../../../electron/utils/logger.js';

const initialState = {
  version: 0,
  hppc: null,
  mppc: null,
  healingCd: false,
  supportCd: false,
  attackCd: false,
  partyNum: 0,
  isWalking: false,
  isTyping: false,
  partyMembers: [],
  activeActionItems: {},
  equippedItems: {
    amulet: null,
    ring: null,
    boots: null,
  },
  itemCache: {},
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
  playerMinimapPosition: { x: 0, y: 0, z: 0, positionSearchMs: null },
  lastMoveTime: null,
  characterName: null,
  lastCharacterName: null,
};

const ITEM_DIMENSION = 34;
const SPACE_BETWEEN_ITEMS = 2;
const TOTAL_TILE_DIMENSION = ITEM_DIMENSION + SPACE_BETWEEN_ITEMS;

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setHealthPercent: (state, action) => {
      state.hppc = action.payload.hppc;
      state.version = (state.version || 0) + 1;
    },
    setManaPercent: (state, action) => {
      state.mppc = action.payload.mppc;
      state.version = (state.version || 0) + 1;
    },
    updateGameStateFromMonitorData: (state, action) => {
      const {
        hppc,
        mppc,
        healingCd,
        supportCd,
        attackCd,
        characterStatus,
        isWalking,
        partyMembers,
        activeActionItems,
        equippedItems,
        itemCache,
        playerMinimapPosition,
      } = action.payload;

      if (hppc !== undefined) state.hppc = hppc;
      if (mppc !== undefined) state.mppc = mppc;
      if (healingCd !== undefined) state.healingCd = healingCd;
      if (supportCd !== undefined) state.supportCd = supportCd;
      if (attackCd !== undefined) state.attackCd = attackCd;

      if (characterStatus !== undefined) {
        const newCharacterStatus = Object.fromEntries(
          Object.keys(state.characterStatus).map((key) => [key, false]),
        );
        for (const key in characterStatus) {
          if (Object.prototype.hasOwnProperty.call(characterStatus, key)) {
            newCharacterStatus[key] = characterStatus[key];
          }
        }
        state.characterStatus = newCharacterStatus;
      }

      if (isWalking !== undefined) state.isWalking = isWalking;
      if (partyMembers !== undefined) {
        state.partyMembers = partyMembers;
        state.partyNum = partyMembers.length;
      }

      if (activeActionItems !== undefined) {
        const processedActionItems = {};
        for (const key in activeActionItems) {
          if (Object.prototype.hasOwnProperty.call(activeActionItems, key)) {
            const item = activeActionItems[key];
            const { x, y } = item;
            const column = Math.floor(x / TOTAL_TILE_DIMENSION) + 1;
            const row = Math.floor(y / TOTAL_TILE_DIMENSION) + 1;
            processedActionItems[key] = {
              ...item,
              position: `${row}x${column}`,
            };
          }
        }
        state.activeActionItems = processedActionItems;
      }

      if (equippedItems !== undefined) {
        for (const key in equippedItems) {
          if (Object.prototype.hasOwnProperty.call(equippedItems, key)) {
            state.equippedItems[key] = equippedItems[key];
          }
        }
      }

      if (itemCache !== undefined) {
        state.itemCache = itemCache;
      }

      if (playerMinimapPosition !== undefined) {
        state.playerMinimapPosition = playerMinimapPosition;
      }
    },
    sethealingCd: (state, action) => {
      state.healingCd = action.payload.healingCd;
      state.version = (state.version || 0) + 1;
    },
    setsupportCd: (state, action) => {
      state.supportCd = action.payload.supportCd;
      state.version = (state.version || 0) + 1;
    },
    setattackCd: (state, action) => {
      state.attackCd = action.payload.attackCd;
      state.version = (state.version || 0) + 1;
    },
    setCharacterStatus: (state, action) => {
      const { characterStatus } = action.payload || {};
      for (const key in characterStatus) {
        if (Object.prototype.hasOwnProperty.call(characterStatus, key)) {
          state.characterStatus[key] = characterStatus[key];
        }
      }
    },
    setPartyNum: (state, action) => {
      state.partyNum = action.payload.partyNum;
      state.version = (state.version || 0) + 1;
    },
    setState: (state, action) => {
      return action.payload;
    },
    setIsTyping: (state, action) => {
      state.isTyping = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setPlayerMinimapPosition: (state, action) => {
      state.playerMinimapPosition = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setLastMoveTime: (state, action) => {
      state.lastMoveTime = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setCharacterName: (state, action) => {
      state.characterName = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setLastCharacterName: (state, action) => {
      state.lastCharacterName = action.payload;
      state.version = (state.version || 0) + 1;
    },
    // --- NEW ATOMIC REDUCER ---
    updateCharacterNames: (state, action) => {
      const { characterName, lastCharacterName } = action.payload;
      if (characterName !== undefined) {
        state.characterName = characterName;
      }
      if (lastCharacterName !== undefined) {
        state.lastCharacterName = lastCharacterName;
      }
    },
  },
});

export const {
  updateGameStateFromMonitorData,
  setHealthPercent,
  setManaPercent,
  sethealingCd,
  setCharacterStatus,
  setPartyNum,
  setState,
  setPlayerMinimapPosition,
  setLastMoveTime,
  setIsTyping,
  setCharacterName,
  setLastCharacterName,
  updateCharacterNames, // --- EXPORT NEW ACTION ---
} = gameStateSlice.actions;

export default gameStateSlice;
