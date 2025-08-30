import { createSlice } from '@reduxjs/toolkit';
import { createLogger } from '../../../electron/utils/logger.js';
const logger = createLogger({ info: true, error: true, debug: true });

const initialState = {
  hppc: null,
  mppc: null,
  healingCd: false,
  supportCd: false,
  attackCd: false,
  supportCd: false,
  attackCd: false,
  partyNum: 0,
  isWalking: false,
  isTyping: false, // Flag to indicate when a typing action is in progress
  partyMembers: [],
  activeActionItems: {}, // This will now store items with an added 'position' key
  equippedItems: {
    amulet: null,
    ring: null,
    boots: null,
  },
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
  playerMinimapPosition: { x: 0, y: 0, z: 0 },
  lastMoveTime: null, // New field to store the last move time
};

const ITEM_DIMENSION = 34; // Each item is 34x34 pixels
const SPACE_BETWEEN_ITEMS = 2; // 2px space between items
const TOTAL_TILE_DIMENSION = ITEM_DIMENSION + SPACE_BETWEEN_ITEMS; // 36px per grid cell

const gameStateSlice = createSlice({
  name: 'gameState',
  initialState,
  reducers: {
    setHealthPercent: (state, action) => {
      state.hppc = action.payload.hppc;
    },
    setManaPercent: (state, action) => {
      state.mppc = action.payload.mppc;
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
        activeActionItems, // This is the key we'll process
        equippedItems,
        playerMinimapPosition, // Add playerMinimapPosition to destructuring
      } = action.payload;

      // Update fields if they are provided in the payload
      if (hppc !== undefined) state.hppc = hppc;
      if (mppc !== undefined) state.mppc = mppc;
      if (healingCd !== undefined) state.healingCd = healingCd;
      if (supportCd !== undefined) state.supportCd = supportCd;
      if (attackCd !== undefined) state.attackCd = attackCd;

      if (characterStatus !== undefined) {
        // Create a new object with all initial statuses set to false
        const newCharacterStatus = Object.fromEntries(
          Object.keys(state.characterStatus).map((key) => [key, false]),
        );

        // Then, merge the active statuses from the payload
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
        state.partyNum = partyMembers.length; // Update partyNum based on the array
      }

      // --- LOGIC TO PROCESS activeActionItems AND ADD 'position' KEY ---
      if (activeActionItems !== undefined) {
        const processedActionItems = {};
        for (const key in activeActionItems) {
          if (Object.prototype.hasOwnProperty.call(activeActionItems, key)) {
            const item = activeActionItems[key];
            const { x, y } = item;

            // Calculate 1-indexed row and column based on coordinates
            // (x / TOTAL_TILE_DIMENSION) gives the 0-indexed column block
            // (y / TOTAL_TILE_DIMENSION) gives the 0-indexed row block
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
      // --- END activeActionItems PROCESSING ---

      if (equippedItems !== undefined) {
        // Merge equippedItems to avoid overwriting other potential equipped fields
        for (const key in equippedItems) {
          if (Object.prototype.hasOwnProperty.call(equippedItems, key)) {
            state.equippedItems[key] = equippedItems[key];
          }
        }
      }

      if (playerMinimapPosition !== undefined) {
        // logger('debug', `[gameStateSlice] updateGameStateFromMonitorData: Updating playerMinimapPosition with:`, playerMinimapPosition);
        state.playerMinimapPosition = playerMinimapPosition;
      }
    },
    sethealingCd: (state, action) => {
      // Note: This reducer seems to have a typo 'rulesCd' instead of 'healingCd'
      // Assuming it should update healingCd based on the name.
      state.healingCd = action.payload.healingCd;
    },
    setsupportCd: (state, action) => {
      state.supportCd = action.payload.supportCd;
    },
    setattackCd: (state, action) => {
      state.attackCd = action.payload.attackCd;
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
    },
    setState: (state, action) => {
      // This reducer completely replaces the state, which might be dangerous
      // unless used very carefully.
      return action.payload;
    },
    setIsTyping: (state, action) => {
      state.isTyping = action.payload;
    },
    setPlayerMinimapPosition: (state, action) => {
      // logger('info', `[gameStateSlice] setPlayerMinimapPosition received payload:`, action.payload);
      state.playerMinimapPosition = action.payload;
    },
    setLastMoveTime: (state, action) => {
      state.lastMoveTime = action.payload;
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
  setLastMoveTime, // Export the new action
  setIsTyping,
} = gameStateSlice.actions;

export default gameStateSlice;
