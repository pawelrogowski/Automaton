import { createSlice } from '@reduxjs/toolkit';

const initialState = [];

const healingSlice = createSlice({
  name: 'healing',
  initialState,
  reducers: {
    addRule: (state, action) => {
      state.push(action.payload);
    },
    removeRule: (state, action) => {
      return state.filter((rule) => rule.id !== action.payload);
    },
    updateRule: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        state[index] = action.payload;
      }
    },
    addColor: (state, action) => {
      const index = state.findIndex((rule) => rule.id === action.payload.id);
      if (index !== -1) {
        const color = { id: Date.now().toString(), color: action.payload.color, enabled: false };
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
  },
});

export const { addRule, removeRule, updateRule, addColor, removeColor, toggleColor } =
  healingSlice.actions;

export default healingSlice;
