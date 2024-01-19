import { createSlice } from '@reduxjs/toolkit';

const initialState = [];

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      const newRule = {
        ...action.payload,
        hpTriggerCondition: action.payload.hpTriggerCondition || '<=',
        manaTriggerCondition: action.payload.manaTriggerCondition || '>=',
      };
      state.push(newRule);
    },
    removeRule: (state, action) => {
      return state.filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        state[index] = action.payload;
        if (state[index].enabled) {
        } else {
        }
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
} = healingSlice.actions;

export default healingSlice;
