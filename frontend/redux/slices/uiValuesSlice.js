// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/uiValuesSlice.js
// --- CORRECTED ---

import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,
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
  players: [],
  npcs: [],
  lastSeenPlayerMs: null,
  lastSeenNpcMs: null,
  preyBalance: null,
  marketSellToList: {
    offers: [],
    lastUpdate: null,
  },
  npcTalkModalTradeItems: {
    items: [],
    lastUpdate: null,
  },
  npcTalkModalSearchInput: {
    text: '',
    lastUpdate: null,
  },
  npcTalkModalAmountInput: {
    amount: '',
    lastUpdate: null,
  },
  npcTalkModalBuySectionActive: {
    active: false,
    lastUpdate: null,
  },
  npcTalkModalSellSectionActive: {
    active: false,
    lastUpdate: null,
  },
  // REMOVED: battleListEntries is no longer part of this slice.
  // Its data now lives exclusively in the battleListSlice.
};

const uiValuesSlice = createSlice({
  name: 'uiValues',
  initialState,
  reducers: {
    setSkillsWidget: (state, action) => {
      if (action.payload) {
        state.skillsWidget = action.payload;
        state.version = (state.version || 0) + 1;
      }
    },
    // REMOVED: setBattleListEntries reducer is gone.
    /**
     * Sets the array of player entities.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {Array<string>} action.payload - An array of player names.
     */
    setPlayers: (state, action) => {
      state.players = action.payload;
      state.version = (state.version || 0) + 1;
    },
    updateLastSeenPlayerMs: (state) => {
      state.lastSeenPlayerMs = Date.now();
    },
    /**
     * Sets the array of NPC entities.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {Array<object>} action.payload - An array of NPC objects, each including a `lastSeen` timestamp.
     */
    setNpcs: (state, action) => {
      state.npcs = action.payload;
      state.version = (state.version || 0) + 1;
    },
    updateLastSeenNpcMs: (state) => {
      state.lastSeenNpcMs = Date.now();
    },
    setPreyBalance: (state, action) => {
      console.log('[uiValuesSlice] setPreyBalance called with:', action.payload);
      state.preyBalance = action.payload;
      state.version = (state.version || 0) + 1;
    },
    setMarketSellToList: (state, action) => {
      state.marketSellToList = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
    },
    setNpcTalkModalTradeItems: (state, action) => {
      state.npcTalkModalTradeItems = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
    },
    setNpcTalkModalSearchInput: (state, action) => {
      state.npcTalkModalSearchInput = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
    },
    setNpcTalkModalAmountInput: (state, action) => {
      state.npcTalkModalAmountInput = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
    },
    setNpcTalkModalBuySectionActive: (state, action) => {
      state.npcTalkModalBuySectionActive = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
    },
    setNpcTalkModalSellSectionActive: (state, action) => {
      state.npcTalkModalSellSectionActive = { ...action.payload, lastUpdate: Date.now() };
      state.version = (state.version || 0) + 1;
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
  setChatboxMain,
  setChatboxSecondary,
  setChatTabs,
  setSelectCharacterModal,
  setVipWidget,
  setPlayers,
  setNpcs,
  updateLastSeenPlayerMs,
  updateLastSeenNpcMs,
  setPreyBalance,
  setMarketSellToList,
  setNpcTalkModalTradeItems,
  setNpcTalkModalSearchInput,
  setNpcTalkModalAmountInput,
  setNpcTalkModalBuySectionActive,
  setNpcTalkModalSellSectionActive,
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
export const selectPlayers = (state) => state.uiValues.players;
export const selectNpcs = (state) => state.uiValues.npcs;
export const selectPreyBalance = (state) => state.uiValues.preyBalance;

export default uiValuesSlice;
