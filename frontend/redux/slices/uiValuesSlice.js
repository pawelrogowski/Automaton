// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/uiValuesSlice.js
// --- MODIFIED ---

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  skillsWidget: {
    level: null,
    experience: null,
    xpGainRate: null,
    hitPoints: null,
    mana: null,
    soulPoints: null,
    capacity: null,
    speed: null,
    food: null,
    stamina: null,
    offlineTraining: null,
    skills: {
      magic: null,
      fist: null,
      club: null,
      sword: null,
      axe: null,
      distance: null,
      shielding: null,
      fishing: null,
    },
    combat: {
      damageHealing: null,
      attack: null,
      defence: null,
      armor: null,
      mantra: null,
      mitigation: null,
    },
  },
  chatboxMain: {
    messages: [],
    lastUpdate: null,
  },
  chatboxSecondary: {
    messages: [],
    lastUpdate: null,
  },
  chatboxTabs: {
    activeTab: null,
    tabs: {},
    lastUpdate: null,
  },
  selectCharacterModal: {
    selectedCharacter: null,
    characters: {},
    accountStatus: null,
    lastUpdate: null,
  },
  vipWidget: {
    online: [],
    offline: [],
    lastUpdate: null,
  },
  // REMOVED gameWorld state
  battleListEntries: [],
  players: [], // NEW: Add players array
};

const uiValuesSlice = createSlice({
  name: 'uiValues',
  initialState,
  reducers: {
    setSkillsWidget: (state, action) => {
      if (action.payload) {
        state.skillsWidget = action.payload;
      }
    },
    setBattleListEntries: (state, action) => {
      state.battleListEntries = action.payload;
    },
    setPlayers: (state, action) => {
      // NEW: Add setPlayers reducer
      state.players = action.payload;
    },
    setChatboxMain: (state, action) => {
      state.chatboxMain.messages = action.payload;
      state.chatboxMain.lastUpdate = Date.now();
    },
    setChatboxSecondary: (state, action) => {
      state.chatboxSecondary.messages = action.payload;
      state.chatboxSecondary.lastUpdate = Date.now();
    },
    setChatTabs: (state, action) => {
      state.chatboxTabs = { ...action.payload, lastUpdate: Date.now() };
    },
    setSelectCharacterModal: (state, action) => {
      state.selectCharacterModal = {
        ...action.payload,
        lastUpdate: Date.now(),
      };
    },
    setVipWidget: (state, action) => {
      state.vipWidget = { ...action.payload, lastUpdate: Date.now() };
    },
    // REMOVED setGameWorldOcr reducer
    resetUiValues: () => initialState,
    resetRegion: (state, action) => {
      const region = action.payload;
      if (initialState[region]) {
        state[region] = initialState[region];
      }
    },
    setState: (state, action) => {
      return action.payload;
    },
  },
});

export const {
  setSkillsWidget,
  setBattleListEntries,
  setChatboxMain,
  setChatboxSecondary,
  setChatTabs,
  setSelectCharacterModal,
  setVipWidget,
  setPlayers, // NEW: Export setPlayers action
  resetUiValues,
  resetRegion,
  setState,
} = uiValuesSlice.actions;

export const selectSkillsWidget = (state) => state.uiValues.skillsWidget;
export const selectSkillsData = (state) => state.uiValues.skillsWidget.skills;
export const selectCombatData = (state) => state.uiValues.skillsWidget.combat;
export const selectCharacterLevel = (state) =>
  state.uiValues.skillsWidget.level;
export const selectCharacterExperience = (state) =>
  state.uiValues.skillsWidget.experience;
export const selectChatboxMainMessages = (state) =>
  state.uiValues.chatboxMain.messages;
export const selectChatboxMainLastUpdate = (state) =>
  state.uiValues.chatboxMain.lastUpdate;
export const selectChatboxSecondaryMessages = (state) =>
  state.uiValues.chatboxSecondary.messages;
export const selectChatboxSecondaryLastUpdate = (state) =>
  state.uiValues.chatboxSecondary.lastUpdate;
export const selectChatboxTabs = (state) => state.uiValues.chatboxTabs;
export const selectChatboxActiveTab = (state) =>
  state.uiValues.chatboxTabs.activeTab;
export const selectChatboxTabsList = (state) => state.uiValues.chatboxTabs.tabs;
export const selectVipWidget = (state) => state.uiValues.vipWidget;
export const selectOnlineVips = (state) => state.uiValues.vipWidget.online;
export const selectOfflineVips = (state) => state.uiValues.vipWidget.offline;
export const selectBattleListEntries = (state) =>
  state.uiValues.battleListEntries;
export const selectPlayers = (state) => state.uiValues.players; // NEW: Add selectPlayers selector
// REMOVED selectGameWorldOcr selector

export default uiValuesSlice;
