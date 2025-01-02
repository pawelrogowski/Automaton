import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

const initialPreset = [
  {
    id: `manaSync${uuidv4()}`,
    name: `userRule${uuidv4()}`,
    enabled: false,
    category: 'Potion',
    key: 'F12',
    hpTriggerCondition: '>=',
    hpTriggerPercentage: '1',
    manaTriggerCondition: '<=',
    manaTriggerPercentage: '80',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    delay: '1000',
    isWalking: false,
    conditions: [],
  },
  {
    id: `manaSync${uuidv4()}`,
    name: `manaSync${uuidv4()}`,
    enabled: false,
    category: 'Potion',
    key: 'F12',
    hpTriggerCondition: '>=',
    hpTriggerPercentage: '1',
    manaTriggerCondition: '<=',
    manaTriggerPercentage: '80',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    delay: '1000',
    isWalking: false,
    conditions: [],
  },
  {
    id: `healFriend${uuidv4()}`,
    name: 'healFriend',
    enabled: false,
    category: 'Healing',
    key: 'T',
    hpTriggerCondition: '>',
    hpTriggerPercentage: '0',
    manaTriggerCondition: '>',
    manaTriggerPercentage: '0',
    friendHpTriggerPercentage: '95',
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: '0',
    requireAttackCooldown: true,
    useRune: true,
    partyPosition: '1',
    delay: '1000',
    isWalking: false,
    conditions: [],
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
    friendHpTriggerPercentage: { key: 'friendHpTriggerPercentage', type: 'number' },
    partyPosition: { key: 'partyPosition', type: 'number' },
    requireAttackCooldown: { key: 'requireAttackCooldown', type: 'boolean' },
    useRune: { key: 'useRune', type: 'boolean' },
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

const validateRule = (rule) => {
  return {
    ...rule,
    friendHpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.friendHpTriggerPercentage, 10) || 80)),
    hpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.hpTriggerPercentage, 10) || 0)),
    manaTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.manaTriggerPercentage, 10) || 0)),
    monsterNum: Math.max(0, Math.min(10, parseInt(rule.monsterNum, 10) || 0)),
    priority: Math.max(-99, Math.min(99, parseInt(rule.priority, 10) || 0)),
    delay: Math.max(0, Math.min(86400000, parseInt(rule.delay, 10) || 0)),
  };
};

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const newRule = {
        id: action.payload,
        enabled: false,
        name: `New Rule`,
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
      state.presets[state.activePresetIndex] = state.presets[state.activePresetIndex].filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const { id, field, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex][field] = validateField(field, value);
    },

    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const rule = state.presets[state.activePresetIndex].find((rule) => rule.id === id);

      if (rule) {
        const conditionIndex = rule.conditions.findIndex((c) => c.name === condition);

        if (conditionIndex !== -1) {
          if (value === undefined) {
            rule.conditions.splice(conditionIndex, 1);
          } else {
            rule.conditions[conditionIndex].value = value;
          }
        } else if (value !== undefined) {
          rule.conditions.push({ name: condition, value });
        }
      }
    },

    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].conditions = state.presets[state.activePresetIndex][ruleIndex].conditions.filter(
        (c) => c.name !== condition,
      );
    },

    loadRules: (state, action) => {
      state.presets[state.activePresetIndex] = action.payload;
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
  removeRule,
  updateRule,
  updateCondition,
  removeCondition,
  loadRules,
  setActivePresetIndex,
  setState,
  sortRulesBy,
  copyPreset,
} = healingSlice.actions;

export default healingSlice;
