import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
  creatures: [], // List of creatures on screen with their coordinates
  target: null, // { name: string, distance: number, gameCoordinates: {x,y,z}, absoluteCoordinates: {x,y} }
  targetingList: [], // [{ id: string, name: string, stance: string, distance: number }]
};

const targetingSlice = createSlice({
  name: 'targeting',
  initialState,
  reducers: {
    setState: (state, action) => {
      // This allows loading a saved state, merging it with the initial state
      // to ensure all keys are present even if the saved file is from an older version.
      return { ...initialState, ...action.payload };
    },
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
    setEntities: (state, action) => {
      // This will be dispatched by the targetMonitor worker
      state.creatures = action.payload;
    },
    setTarget: (state, action) => {
      state.target = action.payload;
    },
    addCreatureToTargetingList: (state, action) => {
      const { id, name, stance, distance } = action.payload;
      state.targetingList.push({ id, name, stance, distance });
    },
    removeCreatureFromTargetingList: (state, action) => {
      state.targetingList = state.targetingList.filter(
        (creature) => creature.id !== action.payload,
      );
    },
    updateCreatureInTargetingList: (state, action) => {
      const { id, updates } = action.payload;
      const creatureIndex = state.targetingList.findIndex(
        (creature) => creature.id === id,
      );
      if (creatureIndex !== -1) {
        state.targetingList[creatureIndex] = {
          ...state.targetingList[creatureIndex],
          ...updates,
        };
      }
    },
  },
});

export const {
  setState,
  setenabled,
  setEntities,
  setTarget,
  addCreatureToTargetingList,
  removeCreatureFromTargetingList,
  updateCreatureInTargetingList,
} = targetingSlice.actions;

export default targetingSlice;
