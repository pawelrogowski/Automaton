import { createSlice } from '@reduxjs/toolkit';

const initialState = [
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
    delay: '2000',
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
    addRule: (state) => {
      const newRule = {
        name: 'New Rule',
        id: Date.now().toString(),
        category: 'Healing',
        key: 'F1',
        priority: 0,
        enabled: false,
        delay: 25,
        hpTriggerPercentage: 80,
        manaTriggerPercentage: 20,
        hpTriggerCondition: '<=',
        manaTriggerCondition: '>=',
        conditions: [],
        monsterNum: 0,
        monsterNumCondition: '>=',
      };
      state.push(newRule);
    },
    removeRule: (state, action) => {
      return state.filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const { id, ...updatedFields } = action.payload;
      const ruleIndex = state.findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        const currentRule = state[ruleIndex];
        const updatedRule = { ...currentRule };

        // Only update and validate the fields that are present in updatedFields
        Object.keys(updatedFields).forEach((field) => {
          switch (field) {
            case 'monsterNum':
              updatedRule[field] = Math.max(0, Math.min(10, updatedFields[field]));
              break;
            case 'hpTriggerPercentage':
            case 'manaTriggerPercentage':
              updatedRule[field] = Math.max(0, Math.min(100, updatedFields[field]));
              break;
            case 'delay':
              updatedRule[field] = Math.max(25, Math.min(840000, updatedFields[field]));
              break;
            case 'priority':
              updatedRule[field] = Math.max(-99, Math.min(99, updatedFields[field]));
              break;
            default:
              updatedRule[field] = updatedFields[field];
          }
        });

        state[ruleIndex] = updatedRule;
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

    updateManaSync: (state, action) => {
      const { key, manaTriggerPercentage } = action.payload;
      const manaSyncRule = state.find((rule) => rule.id === 'manaSync');
      if (manaSyncRule) {
        manaSyncRule.key = key;
        manaSyncRule.manaTriggerPercentage = manaTriggerPercentage;
        manaSyncRule.delay = 2000;
      }
    },
    updateManaSyncTriggerPercentage: (state, action) => {
      const manaSyncRule = state.find((rule) => rule.id === 'manaSync');
      if (manaSyncRule) {
        manaSyncRule.manaTriggerPercentage = action.payload;
      }
    },
    loadRules: (state, action) => {
      return action.payload;
    },
    // In healingSlice.js
    toggleManaSyncEnabled: (state) => {
      const manaSyncRule = state.find((rule) => rule.id === 'manaSync');
      if (manaSyncRule) {
        manaSyncRule.enabled = !manaSyncRule.enabled;
      }
    },
    updateMonsterNum: (state, action) => {
      const { id, monsterNum, monsterNumCondition } = action.payload;
      const ruleIndex = state.findIndex((rule) => rule.id === id);
      if (ruleIndex !== -1) {
        const validMonsterNum = Math.max(0, Math.min(10, monsterNum));
        state[ruleIndex].monsterNum = validMonsterNum;
        state[ruleIndex].monsterNumCondition = monsterNumCondition;
      }
    },
    setState: (state, action) => {
      // console.log(action.payload);
      return action.payload;
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
  setState,
} = healingSlice.actions;

export default healingSlice;
