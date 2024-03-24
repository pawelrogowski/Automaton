import { createSlice } from '@reduxjs/toolkit';

const initialState = [
  {
    name: 'manaSync',
    enabled: false,
    key: 'F12',
    colors: [],
    id: 'manaSync',
    hpTriggerCondition: '>=',
    hpTriggerPercentage: '1',
    manaTriggerCondition: '<=',
    manaTriggerPercentage: '80',
    priority: '0',
    delay: '1800',
    category: 'Potion',
    conditions: [
      {
        name: 'inProtectedZone',
        value: false,
      },
    ],
  },
];

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const newRule = {
        ...action.payload,
        hpTriggerCondition: action.payload.hpTriggerCondition || '<=',
        manaTriggerCondition: action.payload.manaTriggerCondition || '>=',
        conditions: action.payload.conditions || [], // Add this line
      };
      state.push(newRule);
    },
    removeRule: (state, action) => {
      return state.filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        // Merge the existing rule with the payload, preserving the conditions array
        state[index] = {
          ...state[index],
          ...action.payload,
          conditions: state[index].conditions, // Preserve the existing conditions
        };
      }
    },
    updateCondition: (state, action) => {
      const { id, condition, value } = action.payload;
      const ruleIndex = state.findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        const conditionIndex = state[ruleIndex].conditions.findIndex((c) => c.name === condition);
        if (conditionIndex !== -1) {
          if (value === undefined) {
            // Remove the condition object if the value is undefined
            state[ruleIndex].conditions.splice(conditionIndex, 1);
          } else {
            // Update the condition value if it's not undefined
            state[ruleIndex].conditions[conditionIndex].value = value;
          }
        } else {
          // Push a new condition object if it doesn't exist
          state[ruleIndex].conditions.push({ name: condition, value });
        }
      }
    },
    removeCondition: (state, action) => {
      const { id, condition } = action.payload;
      const ruleIndex = state.findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        state[ruleIndex].conditions = state[ruleIndex].conditions.filter(
          (c) => c.name !== condition,
        );
      }
    },
    addColor: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        const color = {
          id: Date.now().toString(),
          color: action.payload.color,
          enabled: true,
          x: action.payload.x,
          y: action.payload.y,
        };
        state[index].colors.push(color);
      }
    },
    removeColor: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        state[index].colors = state[index].colors.filter(
          (color) => color.id !== action.payload.colorId,
        );
      }
    },
    toggleColor: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        const colorIndex = state[index].colors.findIndex(
          (color) => color.id === action.payload.colorId, // Find the color by its ID
        );
        if (colorIndex !== -1) {
          state[index].colors[colorIndex].enabled = !state[index].colors[colorIndex].enabled;
        }
      }
    },
    updateManaSync: (state, action) => {
      const { key, manaTriggerPercentage, enabled } = action.payload;
      const manaSyncRule = state.find((rule) => rule.id === 'manaSync');
      if (manaSyncRule) {
        manaSyncRule.key = key;
        manaSyncRule.enabled = enabled;
        manaSyncRule.manaTriggerPercentage = manaTriggerPercentage;
        manaSyncRule.hpTriggerCondition = '>';
        manaSyncRule.hpTriggerPercentage = '0';
        manaSyncRule.manaTriggerCondition = '<=';
        manaSyncRule.priority = '0';
        manaSyncRule.delay = '2050';
        manaSyncRule.colors = [];
        manaSyncRule.conditions = [];
        manaSyncRule.name = 'manaSync';
      }
    },

    reorderRules: (state, action) => {
      const { startIndex, endIndex } = action.payload;
      const [removed] = state.splice(startIndex, 1);
      state.splice(endIndex, 0, removed);
    },
    loadRules: (state, action) => {
      return action.payload;
    },
  },
});

export const {
  addRule,
  removeRule,
  updateRule,
  addColor,
  removeColor,
  toggleColor,
  reorderRules,
  loadRules,
  updateCondition,
  removeCondition,
  updateManaSync,
} = healingSlice.actions;

export default healingSlice;
