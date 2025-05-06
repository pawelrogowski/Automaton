import { createSlice } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';
import actionBarItemsData from '../../../electron/constants/actionBarItems.js'; // Import for defaults

// Define the allowed potion keys for ManaSync rules (can be shared or redefined)
const ALLOWED_POTION_KEYS = new Set([
    'healthPotion', 'strongHealthPotion', 'greatHealthPotion', 'ultimateHealthPotion',
    'supremeHealthPotion', 'smallHealthPotion', 'manaPotion', 'strongManaPotion',
    'greatManaPotion', 'ultimateManaPotion', 'greatSpiritPotion', 'ultimateSpiritPotion',
]);

// Find a default potion actionItem key (e.g., the first one in the set)
const getDefaultPotionActionItem = () => {
    for (const key of ALLOWED_POTION_KEYS) {
        // Check if it exists in the main data just in case
        if (actionBarItemsData[key]) {
            return key;
        }
    }
    return ''; // Fallback if no valid default is found
};

const DEFAULT_POTION_ACTION_ITEM = getDefaultPotionActionItem();

const initialPreset = [
  {
    id: `userRule${uuidv4()}`,
    name: `Exura`,
    enabled: false,
    category: 'Healing',
    key: 'F1',
    hpTriggerCondition: '<=',
    hpTriggerPercentage: 80,
    manaTriggerCondition: '>',
    manaTriggerPercentage: 5,
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: 10,
    delay: 1000,
    isWalking: false,
    conditions: [],
  },
  {
    id: `userRule${uuidv4()}`,
    name: `ManaPot`,
    enabled: false,
    category: 'Potion',
    key: 'F12',
    hpTriggerCondition: '>',
    hpTriggerPercentage: 0,
    manaTriggerCondition: '<=',
    manaTriggerPercentage: 15,
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: 10,
    delay: 1000,
    isWalking: false,
    conditions: [],
  },
  {
    id: `userRule${uuidv4()}`,
    name: `Mana0Mob`,
    enabled: false,
    category: 'Potion',
    key: 'F12',
    hpTriggerCondition: '>',
    hpTriggerPercentage: 0,
    manaTriggerCondition: '<=',
    manaTriggerPercentage: 85,
    monsterNum: 0,
    monsterNumCondition: '=',
    priority: 0,
    delay: 1000,
    isWalking: false,
    conditions: [],
  },
  {
    id: `userRule${uuidv4()}`,
    name: `Haste`,
    enabled: false,
    category: 'Support',
    key: 'F4',
    hpTriggerCondition: '>',
    hpTriggerPercentage: 0,
    manaTriggerCondition: '>=',
    manaTriggerPercentage: 5,
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: 1,
    delay: 1000,
    isWalking: true,
    conditions: [
      {
        name: 'hasted',
        value: false,
      },
      {
        name: 'inProtectedZone',
        value: false,
      },
    ],
  },
  {
    id: `actionBarItem${uuidv4()}`,
    name: `ActionBarRule${uuidv4()}`,
    enabled: false,
    actionItem: "exuraVita",
    key: 'F4',
    hpTriggerCondition: '>',
    hpTriggerPercentage: 0,
    manaTriggerCondition: '>=',
    manaTriggerPercentage: 5,
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: 0,
    isWalking: false,
    conditions: [
    ],
  },
  {
    id: `manaSync${uuidv4()}`,
    name: `ManaPot`,
    category: "Potion",
    enabled: false,
    key: 'F12',
    hpTriggerCondition: '>=',
    hpTriggerPercentage: 1,
    manaTriggerCondition: '<=',
    manaTriggerPercentage: 80,
    monsterNum: 0,
    monsterNumCondition: '>=',
    priority: 0,
    conditions: [],
  },
  {
    id: `healFriend${uuidv4()}`,
    name: 'UH Friend',
    enabled: false,
    actionItem: 'ultimateHealingRune',
    key: 'T',
    friendHpTriggerPercentage: '50',
    priority: '9',
    requireAttackCooldown: false,
    partyPosition: '0',
    conditions: [],
  },
  {
    id: `rotationRule${uuidv4()}`,
    name: 'Example Rotation',
    enabled: false,
    repeat: true,
    modifierKey: '',
    activationKey: 'F1',
    priority: 0,
    conditions: [],
    sequence: [
      { key: 'F1', delay: 1000, leftClick: false },
      { key: 'F2', delay: 1500, leftClick: false },
    ],
  },
];

const initialState = {
  presets: [initialPreset, initialPreset, initialPreset, initialPreset, initialPreset],
  activePresetIndex: 0,
  sortBy: ['priority'],
  sortOrder: { priority: 'desc' },
};

const sortingCriteriaMap = {
  enabled: { key: 'enabled', type: 'boolean' },
  name: { key: 'name', type: 'string' },
  category: { key: 'category', type: 'string' },
  key: { key: 'key', type: 'string' },
  priority: { key: 'priority', type: 'number' },
  monsterNum: { key: 'monsterNum', type: 'number' },
  hpTriggerPercentage: { key: 'hpTriggerPercentage', type: 'number' },
  manaTriggerPercentage: { key: 'manaTriggerPercentage', type: 'number' },
  friendHpTriggerPercentage: { key: 'friendHpTriggerPercentage', type: 'number' },
  partyPosition: { key: 'partyPosition', type: 'number' },
  requireAttackCooldown: { key: 'requireAttackCooldown', type: 'boolean' },
  actionItem: { key: 'actionItem', type: 'string' },
};

const sortPresetRules = (state) => {
  const { sortBy, sortOrder } = state;
  if (!sortBy || sortBy.length === 0) return;

  const compareValues = (a, b, type, isAscending) => {
    let comparison;
    if (type === 'number') {
      comparison = (Number(a) || 0) - (Number(b) || 0);
    } else if (type === 'string') {
      comparison = String(a || '').localeCompare(String(b || ''));
    } else if (type === 'boolean') {
      comparison = a === b ? 0 : a ? -1 : 1;
    } else {
      return 0;
    }
    return isAscending ? comparison : -comparison;
  };

  state.presets[state.activePresetIndex].sort((a, b) => {
    for (const criterion of sortBy) {
      const criteriaDefinition = sortingCriteriaMap[criterion];
      if (!criteriaDefinition) {
        console.warn(`Sorting criterion "${criterion}" not found.`);
        continue;
      }
      const { key, type } = criteriaDefinition;
      const isAscending = sortOrder[criterion] !== 'desc';
      const valueA = a && typeof a === 'object' && a.hasOwnProperty(key) ? a[key] : undefined;
      const valueB = b && typeof b === 'object' && b.hasOwnProperty(key) ? b[key] : undefined;

      if (valueA === undefined || valueA === null) {
        return (valueB === undefined || valueB === null) ? 0 : (isAscending ? 1 : -1);
      }
      if (valueB === undefined || valueB === null) {
        return isAscending ? -1 : 1;
      }

      const comparison = compareValues(valueA, valueB, type, isAscending);
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
    default:
      return value;
  }
};

const validateRule = (rule) => {
  const validated = {
    ...rule,
    modifierKey: rule.modifierKey ?? '',
    activationKey: rule.activationKey ?? 'F1',
    friendHpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.friendHpTriggerPercentage, 10) || 80)),
    hpTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.hpTriggerPercentage, 10) || 0)),
    manaTriggerPercentage: Math.max(0, Math.min(100, parseInt(rule.manaTriggerPercentage, 10) || 0)),
    monsterNum: Math.max(0, Math.min(10, parseInt(rule.monsterNum, 10) || 0)),
    priority: Math.max(-99, Math.min(99, parseInt(rule.priority, 10) || 0)),
    delay: Math.max(0, Math.min(86400000, parseInt(rule.delay, 10) || 0)),
  };
  delete validated.useRune;
  if (!validated.actionItem) {
    validated.actionItem = 'ultimateHealingRune';
  }

  // Ensure sequence steps have the leftClick property during validation/load
  if (validated.sequence && Array.isArray(validated.sequence)) {
      validated.sequence = validated.sequence.map(step => ({
          ...step,
          leftClick: step.leftClick ?? false // Default to false if missing
      }));
  }

  return validated;
};

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const ruleId = action.payload;
      let newRule;

      if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('manaSync')) {
        newRule = {
          id: ruleId, enabled: true, name: `Mana Sync Rule`,
          actionItem: DEFAULT_POTION_ACTION_ITEM, key: 'F12',
          hpTriggerCondition: '>=', hpTriggerPercentage: 1,
          manaTriggerCondition: '<=', manaTriggerPercentage: 80,
          priority: 0,
          conditions: [],
        };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('healFriend')) {
         newRule = {
            id: ruleId, enabled: false, name: 'New Party Heal',
            actionItem: 'ultimateHealingRune', key: 'T',
            hpTriggerCondition: '>', hpTriggerPercentage: 0,
            manaTriggerCondition: '>', manaTriggerPercentage: 0,
            friendHpTriggerPercentage: 50,
            priority: 9, requireAttackCooldown: false, partyPosition: '0',
            conditions: [],
         };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('actionBarItem')) {
          newRule = {
              id: ruleId, enabled: false, name: `New Action Rule`,
              actionItem: "", key: 'F1',
              hpTriggerCondition: '>=', hpTriggerPercentage: 80,
              manaTriggerCondition: '>=', manaTriggerPercentage: 20,
              monsterNumCondition: '>=', monsterNum: 0,
              priority: 0, delay: 250,
              conditions: [],
          };
      } else if (ruleId && typeof ruleId === 'string' && ruleId.startsWith('rotationRule')) {
          newRule = {
              id: ruleId,
              name: 'New Rotation',
              enabled: false,
              repeat: true,
              modifierKey: '',
              activationKey: 'F1',
              priority: 0,
              conditions: [],
              sequence: [
                  { key: 'F1', delay: 1000, leftClick: false },
              ],
          };
      } else {
        newRule = {
          id: ruleId || `userRule${uuidv4()}`, enabled: false, name: `New Rule`,
          category: 'Healing',
          key: 'F1',
          hpTriggerCondition: '<=', hpTriggerPercentage: 80,
          manaTriggerCondition: '>=', manaTriggerPercentage: 20,
          monsterNumCondition: '>=', monsterNum: 0,
          priority: 0,
          conditions: [],
        };
      }

      if (newRule) {
         state.presets[state.activePresetIndex].push(newRule);
         sortPresetRules(state);
      } else {
         console.warn("No rule type matched for ID:", ruleId);
      }
    },

    removeRule: (state, action) => {
      state.presets[state.activePresetIndex] = state.presets[state.activePresetIndex].filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const { id, field, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        // Ensure sequence updates correctly merge nested properties like leftClick
        if (field === 'sequence' && Array.isArray(value)) {
             // Make sure incoming sequence steps retain/default the leftClick property
             const updatedSequence = value.map(step => ({
                 ...step,
                 leftClick: step.leftClick ?? false
             }));
             state.presets[state.activePresetIndex][ruleIndex][field] = updatedSequence;
        } else {
            state.presets[state.activePresetIndex][ruleIndex][field] = validateField(field, value);
        }
        sortPresetRules(state);
      }
    },

    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      if (ruleIndex !== -1) {
        const rule = state.presets[state.activePresetIndex][ruleIndex];
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
        sortPresetRules(state);
      }
    },

    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.presets[state.activePresetIndex].findIndex((rule) => rule.id === id);

      state.presets[state.activePresetIndex][ruleIndex].conditions = state.presets[state.activePresetIndex][ruleIndex].conditions.filter(
        (c) => c.name !== condition,
      );
      sortPresetRules(state);
    },

    loadRules: (state, action) => {
      state.presets[state.activePresetIndex] = action.payload;
      sortPresetRules(state);
    },

    setActivePresetIndex: (state, action) => {
      state.activePresetIndex = action.payload;
      sortPresetRules(state);
    },
    setState: (state, action) => {
      const cleanPreset = (preset) => preset.map(rule => {
        const cleanedRule = { ...rule };
        if (rule.id.includes('manaSync') || rule.id.includes('actionBarItem') || rule.id.includes('healFriend') || rule.id.includes('rotationRule')) {
          delete cleanedRule.category;
        }
        if (rule.id.includes('manaSync')) {
          delete cleanedRule.delay;
          delete cleanedRule.isWalking;
          delete cleanedRule.monsterNum;
          delete cleanedRule.monsterNumCondition;
        }
        if (rule.id.includes('actionBarItem')) {
        }
        if (rule.id.includes('healFriend')) {
        }
        return validateRule(cleanedRule);
      });
      if (!Array.isArray(action.payload.presets)) {
        state.presets = [cleanPreset(action.payload)];
        state.activePresetIndex = 0;
      } else {
        state.presets = action.payload.presets.map((preset) => cleanPreset(preset));
        state.activePresetIndex = Math.max(0, Math.min((state.presets?.length || 1) - 1, action.payload.activePresetIndex || 0));
      }
      state.sortBy = action.payload.sortBy || initialState.sortBy;
      state.sortOrder = action.payload.sortOrder || initialState.sortOrder;
      sortPresetRules(state);
    },
    sortRulesBy: (state, action) => {
      const newSortBy = action.payload;

      const primaryCriterion = newSortBy[0];
      if (state.sortBy && state.sortBy[0] === primaryCriterion) {
        state.sortOrder[primaryCriterion] = state.sortOrder[primaryCriterion] === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortOrder = { [primaryCriterion]: 'desc' };
      }

      state.sortBy = newSortBy;

      newSortBy.slice(1).forEach(criterion => {
        if (!state.sortOrder[criterion]) {
          state.sortOrder[criterion] = 'asc';
        }
      });

      sortPresetRules(state);
    },
    copyPreset: (state, action) => {
      const { sourceIndex, targetIndex } = action.payload;
      if (sourceIndex !== targetIndex && sourceIndex >= 0 && sourceIndex < state.presets.length && targetIndex >= 0 && targetIndex < state.presets.length) {
        state.presets[targetIndex] = JSON.parse(JSON.stringify(state.presets[sourceIndex]));
        if (targetIndex === state.activePresetIndex) {
          sortPresetRules(state);
        }
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
