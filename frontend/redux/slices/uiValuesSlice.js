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
  battleListEntries: [],
};

const uiValuesSlice = createSlice({
  name: 'uiValues',
  initialState,
  reducers: {
    // --- All reducers are now simple, direct state assignments ---

    /**
     * Sets the entire skills widget state from a fully parsed object.
     */
    setSkillsWidget: (state, action) => {
      // The payload is the final, structured object from the worker's parser.
      if (action.payload) {
        state.skillsWidget = action.payload;
      }
    },

    /**
     * Sets the battle list with a final array of monster names.
     */
    setBattleListEntries: (state, action) => {
      state.battleListEntries = action.payload;
    },

    /**
     * Sets the main chatbox messages from a parsed array.
     */
    setChatboxMain: (state, action) => {
      state.chatboxMain.messages = action.payload;
      state.chatboxMain.lastUpdate = Date.now();
    },

    /**
     * Sets the secondary chatbox messages from a parsed array.
     */
    setChatboxSecondary: (state, action) => {
      state.chatboxSecondary.messages = action.payload;
      state.chatboxSecondary.lastUpdate = Date.now();
    },

    /**
     * Sets the chat tabs state from a parsed object.
     */
    setChatTabs: (state, action) => {
      state.chatboxTabs = { ...action.payload, lastUpdate: Date.now() };
    },

    /**
     * Sets the character selection modal state from a parsed object.
     */
    setSelectCharacterModal: (state, action) => {
      state.selectCharacterModal = {
        ...action.payload,
        lastUpdate: Date.now(),
      };
    },

    /**
     * Sets the VIP widget state from a parsed object.
     */
    setVipWidget: (state, action) => {
      state.vipWidget = { ...action.payload, lastUpdate: Date.now() };
    },

    // --- Utility Reducers (Unchanged) ---

    /**
     * Resets the entire uiValues state to its initial state.
     */
    resetUiValues: () => initialState,

    /**
     * Resets a specific region to its initial state.
     * @param {string} action.payload - The region name to reset (e.g., 'skillsWidget').
     */
    resetRegion: (state, action) => {
      const region = action.payload;
      if (initialState[region]) {
        state[region] = initialState[region];
      }
    },

    /**
     * Replaces the entire slice state. Use with caution.
     */
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
  resetUiValues,
  resetRegion,
  setState,
} = uiValuesSlice.actions;

// --- Selectors (Unchanged) ---
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

export default uiValuesSlice;
