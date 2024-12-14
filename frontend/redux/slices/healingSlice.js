import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

const initialPreset = [
  {
    name: `manaSync${uuidv4()}`,
    enabled: false,
    key: 'F12',
    id: `manaSync${uuidv4()}`,
    hpTriggerCondition: '>=',
    hpTriggerPercentage: '1',
    manaTriggerCondition: '<=',
    manaTriggerPercentage: '80',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    delay: '1000',
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
    id: `healFriend${uuidv4()}`,
    hpTriggerCondition: '>',
    hpTriggerPercentage: '0',
    manaTriggerCondition: '>',
    manaTriggerPercentage: '0',
    friendHpTriggerPercentage: '95',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    requireManaShield: true,
    requireAttackCooldown: true,
    useRune: true,
    delay: '1000',
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
  sortOrder: {},
};

const sortRules = (state, sortBy) => {
  const compareValues = (a, b, type, isAscending) => {
    let comparison;
    if (type === 'number') {
      comparison = a - b;
    } else if (type === 'string') {
      comparison = a.localeCompare(b);
    } else if (type === 'boolean') {
      comparison = a === b ? 0 : a ? -1 : 1;
    } else {
      return 0;
    }
    return isAscending ? comparison : -comparison;
  };

  const sortingCriteria = {
    enabled: { key: 'enabled', type: 'boolean' },
    name: { key: 'name', type: 'string' },
    category: { key: 'category', type: 'string' },
    key: { key: 'key', type: 'string' },
    priority: { key: 'priority', type: 'number' },
    delay: { key: 'delay', type: 'number' },
    monsterNum: { key: 'monsterNum', type: 'number' },
    hpTriggerPercentage: { key: 'hpTriggerPercentage', type: 'number' },
    manaTriggerPercentage: { key: 'manaTriggerPercentage', type: 'number' },
  };

  state.presets[state.activePresetIndex].sort((a, b) => {
    for (const criterion of sortBy) {
      const { key, type } = sortingCriteria[criterion];
      const isAscending = state.sortOrder[criterion] !== 'desc';
      const comparison = compareValues(a[key], b[key], type, isAscending);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
};

const validateRule = (rule) => {
  return {
    ...rule,
    friendHpTriggerPercentage: Math.max(
      0,
      Math.min(100, parseInt(rule.friendHpTriggerPercentage, 10) || 80),
    ),
    hpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.hpTriggerPercentage, 10) || 0)),
    manaTriggerPercentage: Math.max(
      0,
      Math.min(100, parseInt(rule.manaTriggerPercentage, 10) || 0),
    ),
    monsterNum: Math.max(0, Math.min(10, parseInt(rule.monsterNum, 10) || 0)),
    priority: Math.max(-99, Math.min(99, parseInt(rule.priority, 10) || 0)),
    delay: Math.max(0, Math.min(86400000, parseInt(rule.delay, 10) || 0)),
  };
};
const validateField = (field, value) => {
  switch (field) {
    case 'friendHpTriggerPercentage':
    case 'hpTriggerPercentage':
    case 'manaTriggerPercentage':
      return Math.max(0, Math.min(100, parseInt(value, 10) || 0));
    case 'monsterNum':
      return Math.max(0, Math.min(10, parseInt(value, 10) || 0));
    case 'priority':
      return Math.max(-999, Math.min(999, parseInt(value, 10) || 0));
    case 'delay':
      return Math.max(0, Math.min(86400000, parseInt(value, 10) || 0));
    default:
      return value;
  }
};

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const newRuleName = `Rule ${state.presets[state.activePresetIndex].length + 1}`;
      const newRule = validateRule({
        id: `userrule${action.payload}`,
        enabled: false,
        name: newRuleName,
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
      });
      state.presets[state.activePresetIndex].push(newRule);
    },
    addHealFriendRule: (state, action) => {
      const newRule = validateRule({
        id: `healFriend${action.payload}`,
        enabled: false,
        name: 'New Rule',
        category: 'Healing',
        key: 'T',
        hpTriggerCondition: '>',
        hpTriggerPercentage: '0',
        manaTriggerCondition: '>',
        manaTriggerPercentage: '0',
        friendHpTriggerPercentage: '80',
        monsterNum: 0,
        monsterNumCondition: '>=',
        priority: '0',
        requireManaShield: false,
        requireAttackCooldown: false,
        useRune: false,
        delay: '1000',
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
        conditions: [],
      });
      state.presets[state.activePresetIndex].push(newRule);
    },
    addManaSyncRule: (state, action) => {
      const newRule = validateRule({
        id: `manaSync${action.payload}`,
        enabled: false,
        name: 'New Rule',
        category: 'Potion',
        key: 'F12',
        hpTriggerCondition: '>=',
        hpTriggerPercentage: 0,
        manaTriggerCondition: '<=',
        manaTriggerPercentage: 75,
        monsterNumCondition: '>=',
        monsterNum: 0,
        priority: 0,
        delay: 250,
        conditions: [],
      });
      state.presets[state.activePresetIndex].push(newRule);
    },

    removeRule: (state, action) => {
      state.presets[state.activePresetIndex] = state.presets[state.activePresetIndex].filter(
        (rule) => rule.id !== action.payload,
      );
    },

    updateRuleName: (state, action) => {
      const { id, name } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].name = name;
    },
    updateRuleEnabled: (state, action) => {
      const { id, enabled } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].enabled = enabled;
    },
    updateRuleCategory: (state, action) => {
      const { id, category } = action.payload;
      console.log('ID WHEN CHANGING VALUE', id);
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].category = category;
    },
    updateRuleKey: (state, action) => {
      const { id, key } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      console.log(state.activePresetIndex, ruleIndex);
      state.presets[state.activePresetIndex][ruleIndex].key = key;
    },
    updateRuleHpTrigger: (state, action) => {
      const { id, condition, percentage } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].hpTriggerCondition = condition;
      state.presets[state.activePresetIndex][ruleIndex].hpTriggerPercentage = validateField(
        'hpTriggerPercentage',
        percentage,
      );
    },

    updateRuleManaTrigger: (state, action) => {
      const { id, condition, percentage } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].manaTriggerCondition = condition;
      state.presets[state.activePresetIndex][ruleIndex].manaTriggerPercentage = validateField(
        'manaTriggerPercentage',
        percentage,
      );
    },

    updateRuleFriendHpTrigger: (state, action) => {
      const { id, condition, percentage } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].friendHpTriggerCondition = condition;
      state.presets[state.activePresetIndex][ruleIndex].friendHpTriggerPercentage = validateField(
        'friendHpTriggerPercentage',
        percentage,
      );
    },

    updateRuleMonsterNum: (state, action) => {
      const { id, condition, num } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].monsterNumCondition = condition;
      state.presets[state.activePresetIndex][ruleIndex].monsterNum = validateField(
        'monsterNum',
        num,
      );
    },
    updateRulePriority: (state, action) => {
      const { id, priority } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].priority = validateField(
        'priority',
        priority,
      );
    },
    updateRuleDelay: (state, action) => {
      const { id, delay } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].delay = validateField('delay', delay);
    },

    updateRule: (state, action) => {
      const { id, ...updatedFields } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex] = validateRule({
        ...state.presets[state.activePresetIndex][ruleIndex],
        ...updatedFields,
      });
    },

    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      const conditionIndex = state.presets[state.activePresetIndex][ruleIndex].conditions.findIndex(
        (c) => c.name === condition,
      );
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
    },

    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].conditions = state.presets[
        state.activePresetIndex
      ][ruleIndex].conditions.filter((c) => c.name !== condition);
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
      state.presets[state.activePresetIndex] = action.payload.map(validateRule);
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
        state.presets = [action.payload.map(validateRule)];
        state.activePresetIndex = 0;
      } else {
        state.presets = action.payload.presets.map((preset) => preset.map(validateRule));
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
        Object.assign(healFriendRule, validateRule({ ...healFriendRule, ...updatedFields }));
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

    toggleAttackCooldownRequired: (state) => {
      const healFriendRule = state.presets[state.activePresetIndex].find(
        (rule) => rule.id === 'healFriend',
      );
      if (healFriendRule) {
        healFriendRule.requireAttackCooldown = !healFriendRule.requireAttackCooldown;
      }
    },
    sortRulesBy: (state, action) => {
      const sortBy = action.payload; // An array of sorting criteria

      // Toggle sort order for the first criterion
      const primaryCriterion = sortBy[0];
      if (state.sortOrder[primaryCriterion] === 'desc') {
        state.sortOrder[primaryCriterion] = 'asc';
      } else {
        state.sortOrder[primaryCriterion] = 'desc';
      }

      // Reset sort order for other criteria
      sortBy.slice(1).forEach((criterion) => {
        state.sortOrder[criterion] = 'asc';
      });

      sortRules(state, sortBy);
    },
    copyPreset: (state, action) => {
      const { sourceIndex, targetIndex } = action.payload;
      if (sourceIndex !== targetIndex && sourceIndex >= 0 && sourceIndex < state.presets.length) {
        state.presets[targetIndex] = JSON.parse(JSON.stringify(state.presets[sourceIndex]));
      }
    },
  },
});

export const {
  addRule,
  addHealFriendRule,
  addManaSyncRule,
  removeRule,
  updateRuleName,
  updateRuleEnabled,
  updateRuleCategory,
  updateRuleKey,
  updateRuleHpTrigger,
  updateRuleManaTrigger,
  updateRuleFriendHpTrigger,
  updateRuleMonsterNum,
  updateRulePriority,
  updateRuleDelay,
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
  toggleAttackCooldownRequired,
  cyclePresets,
  sortRulesBy,
  copyPreset,
} = healingSlice.actions;

export default healingSlice;
