import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
  stance: 'Ignore', // 'keepAway', 'waitAndKeepAway', 'Reach', 'Stand', 'Ignore'
  distance: 2, // Integer distance for stances
  creatures: [], // List of creatures on screen with their coordinates
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
    setStance: (state, action) => {
      state.stance = action.payload;
    },
    setDistance: (state, action) => {
      state.distance = action.payload;
    },
    setEntities: (state, action) => {
      // This will be dispatched by the entityMonitor worker
      state.creatures = action.payload;
    },
  },
});

export const { setState, setenabled, setStance, setDistance, setEntities } =
  targetingSlice.actions;

export default targetingSlice;
