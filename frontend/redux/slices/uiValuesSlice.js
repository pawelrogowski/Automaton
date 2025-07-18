import { createSlice } from '@reduxjs/toolkit';
import { parseChatData } from '../../../electron/workers/ocrWorker/parsers.js';

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
  // Future regions can be added here
};

/**
 * Parses the raw OCR data from skills widget into structured values
 * @param {Array} ocrData - Array of OCR text objects with x, y, text properties
 * @returns {Object} Structured skills widget data
 */
function parseSkillsWidgetData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return initialState.skillsWidget;
  }

  const result = { ...initialState.skillsWidget };
  const skills = { ...initialState.skillsWidget.skills };
  const combat = { ...initialState.skillsWidget.combat };

  // Filter out artifacts like "-- -" and empty strings
  const validData = ocrData.filter((item) => item.text && item.text.trim() && !item.text.match(/^[-\s]*$/) && item.text !== 'alue');

  // Create a map of text labels to their corresponding values
  const textMap = new Map();

  // Group by approximate y-coordinate (within 5 pixels tolerance)
  const rows = new Map();
  validData.forEach((item) => {
    let rowKey = null;
    for (const [key, rowItems] of rows.entries()) {
      if (Math.abs(item.y - key) <= 5) {
        rowKey = key;
        break;
      }
    }
    if (rowKey === null) {
      rowKey = item.y;
    }
    if (!rows.has(rowKey)) {
      rows.set(rowKey, []);
    }
    rows.get(rowKey).push(item);
  });

  // Process each row to find label-value pairs
  const processedRows = Array.from(rows.values());

  processedRows.forEach((row) => {
    // Sort by x-coordinate within each row
    row.sort((a, b) => a.x - b.x);

    // Find label-value pairs
    for (let i = 0; i < row.length - 1; i++) {
      const label = row[i].text.trim();
      const value = row[i + 1]?.text?.trim();

      if (!value) continue;

      // Map labels to their corresponding fields
      switch (label.toLowerCase()) {
        case 'level':
          result.level = parseInt(value) || null;
          break;
        case 'experience':
          result.experience = parseInt(value.replace(/,/g, '')) || null;
          break;
        case 'xp gain rate':
          result.xpGainRate = parseFloat(value.replace('%', '')) || null;
          break;
        case 'hit points':
          result.hitPoints = parseInt(value) || null;
          break;
        case 'mana':
          result.mana = parseInt(value) || null;
          break;
        case 'soul points':
          result.soulPoints = parseInt(value) || null;
          break;
        case 'capacity':
          result.capacity = parseInt(value) || null;
          break;
        case 'speed':
          result.speed = parseInt(value) || null;
          break;
        case 'food':
          result.food = value; // Keep as string for time format
          break;
        case 'stamina':
          result.stamina = value; // Keep as string for time format
          break;
        case 'offline training':
          result.offlineTraining = value; // Keep as string for time format
          break;
        case 'magic':
          skills.magic = parseInt(value) || null;
          break;
        case 'fist':
          skills.fist = parseInt(value) || null;
          break;
        case 'club':
          skills.club = parseInt(value) || null;
          break;
        case 'sword':
          skills.sword = parseInt(value) || null;
          break;
        case 'axe':
          skills.axe = parseInt(value) || null;
          break;
        case 'distance':
          skills.distance = parseInt(value) || null;
          break;
        case 'shielding':
          skills.shielding = parseInt(value) || null;
          break;
        case 'fishing':
          skills.fishing = parseInt(value) || null;
          break;
        case 'damage/healing':
          combat.damageHealing = parseInt(value) || null;
          break;
        case 'attack':
          if (value.endsWith('V')) {
            combat.attack = parseInt(value.replace('V', '')) || null;
          }
          break;
        case 'defence':
          if (value.endsWith('V')) {
            combat.defence = parseInt(value.replace('V', '')) || null;
          }
          break;
        case 'armor':
          if (value.endsWith('V')) {
            combat.armor = parseInt(value.replace('V', '')) || null;
          }
          break;
        case 'mantra':
          if (value.endsWith('V')) {
            combat.mantra = parseInt(value.replace('V', '')) || null;
          }
          break;
        case 'mitigation':
          if (value.includes('%')) {
            combat.mitigation = parseFloat(value.replace(/[+%]/g, '')) || null;
          }
          break;
      }
    }
  });

  return {
    ...result,
    skills,
    combat,
  };
}

/**
 * Parses the raw OCR data from chat box tabs into structured tab data
 * @param {Array} ocrData - Array of OCR text objects with x, y, text, click, and color properties
 * @returns {Object} Structured chat tabs data with activeTab and tabs
 */
function parseChatTabsData(ocrData) {
  if (!Array.isArray(ocrData) || ocrData.length === 0) {
    return initialState.chatboxTabs;
  }

  const tabs = {};
  let activeTab = null;

  ocrData.forEach((item) => {
    const tabName = item.text.trim();
    if (!tabName) return;

    // Create tab entry with position data
    tabs[tabName] = {
      tabName,
      tabPosition: {
        x: item.click.x,
        y: item.click.y,
      },
      originalPosition: {
        x: item.x,
        y: item.y,
      },
    };

    // Check if this is the active tab (color [223, 223, 223])
    if (item.color && item.color.r === 223 && item.color.g === 223 && item.color.b === 223) {
      activeTab = tabName;
    }
  });

  return {
    activeTab,
    tabs,
    lastUpdate: Date.now(),
  };
}

const uiValuesSlice = createSlice({
  name: 'uiValues',
  initialState,
  reducers: {
    /**
     * Updates the skills widget with parsed OCR data
     * @param {object} state - The current state
     * @param {object} action - The action object
     * @param {Array} action.payload - The OCR data array from skills widget
     */
    updateSkillsWidget: (state, action) => {
      state.skillsWidget = parseSkillsWidgetData(action.payload);
    },

    /**
     * Updates a specific region with parsed data
     * @param {object} state - The current state
     * @param {object} action - The action object
     * @param {string} action.payload.region - The region name (e.g., 'skillsWidget')
     * @param {Array} action.payload.data - The OCR data array
     */
    updateRegionData: (state, action) => {
      const { region, data } = action.payload;
      if (region === 'skillsWidget') {
        state.skillsWidget = parseSkillsWidgetData(data);
      } else if (region === 'chatboxMain') {
        state.chatboxMain.messages = parseChatData(data);
        state.chatboxMain.lastUpdate = Date.now();
      } else if (region === 'chatboxSecondary') {
        state.chatboxSecondary.messages = parseChatData(data);
        state.chatboxSecondary.lastUpdate = Date.now();
      } else if (region === 'chatBoxTabRow') {
        state.chatboxTabs = parseChatTabsData(data);
      }
      // Add handlers for other regions as needed
    },

    /**
     * Resets the entire uiValues state to initial state
     */
    resetUiValues: (state) => {
      return initialState;
    },

    /**
     * Resets a specific region to its initial state
     * @param {object} state - The current state
     * @param {object} action - The action object
     * @param {string} action.payload - The region name to reset
     */
    resetRegion: (state, action) => {
      const region = action.payload;
      if (region === 'skillsWidget') {
        state.skillsWidget = initialState.skillsWidget;
      }
    },

    /**
     * Replaces the entire slice state. Use with caution.
     * @param {object} state - The current state
     * @param {object} action - The action containing the new state
     */
    setState: (state, action) => {
      return action.payload;
    },
  },
});

export const { updateSkillsWidget, updateRegionData, resetUiValues, resetRegion, setState } = uiValuesSlice.actions;

// Selectors
export const selectSkillsWidget = (state) => state.uiValues.skillsWidget;
export const selectSkillsData = (state) => state.uiValues.skillsWidget.skills;
export const selectCombatData = (state) => state.uiValues.skillsWidget.combat;
export const selectCharacterLevel = (state) => state.uiValues.skillsWidget.level;
export const selectCharacterExperience = (state) => state.uiValues.skillsWidget.experience;
export const selectChatboxMainMessages = (state) => state.uiValues.chatboxMain.messages;
export const selectChatboxMainLastUpdate = (state) => state.uiValues.chatboxMain.lastUpdate;
export const selectChatboxSecondaryMessages = (state) => state.uiValues.chatboxSecondary.messages;
export const selectChatboxSecondaryLastUpdate = (state) => state.uiValues.chatboxSecondary.lastUpdate;
export const selectChatboxTabs = (state) => state.uiValues.chatboxTabs;
export const selectChatboxActiveTab = (state) => state.uiValues.chatboxTabs.activeTab;
export const selectChatboxTabsList = (state) => state.uiValues.chatboxTabs.tabs;

export default uiValuesSlice;
