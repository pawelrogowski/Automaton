import { createSlice } from '@reduxjs/toolkit';

const initialPreset = [
  {
    name: 'manaSync',
    enabled: false,
    key: 'F12',
    id: 'manaSync',
    hpTriggerCondition: '>=',
    hpTriggerPercentage: '1',
    manaTriggerCondition: '<=',
    manaTriggerPercentage: '80',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    delay: '975',
    category: 'Potion',
    conditions: [
      {
        name: 'inProtectedZone',
        value: false,
      },
    ],
  },
  {
    name: 'healFriend',
    enabled: false,
    key: 'T',
    id: 'healFriend',
    hpTriggerCondition: '>',
    hpTriggerPercentage: '0',
    manaTriggerCondition: '>',
    manaTriggerPercentage: '0',
    friendHpTriggerPercentage: '95',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    requireManaShield: true,
    useRune: true,
    delay: '975',
    category: 'Healing',
    conditions: [
      {
        name: 'magicShield',
        value: true,
      },
      {
        name: 'eRing',
        value: true,
      },
    ],
  },
];

const initialState = {
  presets: [initialPreset, initialPreset, initialPreset, initialPreset, initialPreset],
  activePresetIndex: 0,
};

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const newRule = {
        id: Date.now().toString(),
        enabled: false,
        name: 'New Rule',
        category: 'Healing',
        key: 'F1',
        hpTriggerCondition: '<=',
        hpTriggerPercentage: 80,
        manaTriggerCondition: '>=',
        manaTriggerPercentage: 20,
        monsterNumCondition: '>=',
        monsterNum: 0,
        priority: 0,
        delay: 250,
        conditions: [],
      };
      state.presets[state.activePresetIndex].push(newRule);
    },
    removeRule: (state, action) => {
      state.presets[state.activePresetIndex] = state.presets[state.activePresetIndex].filter(
        (rule) => rule.id !== action.payload,
      );
    },
    updateRule: (state, action) => {
      const { id, ...updatedFields } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        state.presets[state.activePresetIndex][ruleIndex] = {
          ...state.presets[state.activePresetIndex][ruleIndex],
          ...updatedFields,
        };
      }
    },
    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        const conditionIndex = state.presets[state.activePresetIndex][
          ruleIndex
        ].conditions.findIndex((c) => c.name === condition);
        if (conditionIndex !== -1) {
          if (value === undefined) {
            state.presets[state.activePresetIndex][ruleIndex].conditions.splice(conditionIndex, 1);
          } else {
            state.presets[state.activePresetIndex][ruleIndex].conditions[conditionIndex].value =
              value;
          }
        } else {
          state.presets[state.activePresetIndex][ruleIndex].conditions.push({
            name: condition,
            value,
          });
        }
      }
    },
    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        state.presets[state.activePresetIndex][ruleIndex].conditions = state.presets[
          state.activePresetIndex
        ][ruleIndex].conditions.filter((c) => c.name !== condition);
      }
    },
    updateManaSync: (state, action) => {
      const { key, manaTriggerPercentage } = action.payload;
      const manaSyncRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'manaSync',
      );
      if (manaSyncRule) {
        manaSyncRule.key = key;
        manaSyncRule.manaTriggerPercentage = manaTriggerPercentage;
        manaSyncRule.delay = 975;
      }
    },
    updateManaSyncTriggerPercentage: (state, action) => {
      const manaSyncRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'manaSync',
      );
      if (manaSyncRule) {
        manaSyncRule.manaTriggerPercentage = action.payload;
      }
    },
    loadRules: (state, action) => {
      state.presets[state.activePresetIndex] = action.payload;
    },
    toggleManaSyncEnabled: (state) => {
      const manaSyncRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'manaSync',
      );
      if (manaSyncRule) {
        manaSyncRule.enabled = !manaSyncRule.enabled;
      }
    },
    updateMonsterNum: (state, action) => {
      const { id, monsterNum, monsterNumCondition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        const validMonsterNum = Math.max(0, Math.min(10, monsterNum));
        state.presets[state.activePresetIndex][ruleIndex].monsterNum = validMonsterNum;
        state.presets[state.activePresetIndex][ruleIndex].monsterNumCondition = monsterNumCondition;
      }
    },
    setActivePresetIndex: (state, action) => {
      state.activePresetIndex = action.payload;
    },
    setState: (state, action) => {
      // Handle backward compatibility
      if (!Array.isArray(action.payload.presets)) {
        state.presets = [action.payload];
        state.activePresetIndex = 0;
      } else {
        state.presets = action.payload.presets;
        state.activePresetIndex = action.payload.activePresetIndex;
      }
    },
    cyclePresets: (state, action) => {
      const direction = action.payload;
      const currentIndex = state.activePresetIndex;

      if (direction === 'next') {
        state.activePresetIndex = (currentIndex + 1) % state.presets.length;
      } else if (direction === 'previous') {
        state.activePresetIndex = (currentIndex - 1 + state.presets.length) % state.presets.length;
      }
    },
    updateHealFriend: (state, action) => {
      const { id, ...updatedFields } = action.payload;
      const healFriendRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'healFriend',
      );
      if (healFriendRule) {
        Object.assign(healFriendRule, updatedFields);
      }
    },
    toggleHealFriendEnabled: (state) => {
      const healFriendRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'healFriend',
      );
      if (healFriendRule) {
        healFriendRule.enabled = !healFriendRule.enabled;
      }
    },
    toggleManaShieldRequired: (state) => {
      const healFriendRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'healFriend',
      );
      if (healFriendRule) {
        healFriendRule.requireManaShield = !healFriendRule.requireManaShield;
      }
    },
    toggleUseRune: (state) => {
      const healFriendRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'healFriend',
      );
      if (healFriendRule) {
        healFriendRule.useRune = !healFriendRule.useRune;
      }
    },
  },
});

export const {
  addRule,
  removeRule,
  updateRule,
  loadRules,
  updateCondition,
  removeCondition,
  updateManaSync,
  toggleManaSyncEnabled,
  updateMonsterNum,
  updateManaSyncTriggerPercentage,
  setActivePresetIndex,
  setState,
  updateHealFriend,
  toggleHealFriendEnabled,
  toggleManaShieldRequired,
  toggleUseRune,
} = healingSlice.actions;

export default healingSlice;
