// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/targetingSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
  stickiness: 0,
  // The shape of a creature object now includes instanceId and isReachable
  creatures: [], // [{ instanceId, name, healthTag, absoluteCoords, gameCoords, distance, isReachable }]
  target: null, // { instanceId, name, ... }
  targetingList: [],
};

const targetingSlice = createSlice({
  name: 'targeting',
  initialState,
  reducers: {
    setState: (state, action) => {
      const loadedState = action.payload;
      if (loadedState && loadedState.targetingList) {
        loadedState.targetingList = loadedState.targetingList.map(
          (creature) => ({
            priority: 0,
            action: 'Attack',
            healthRange: 'Any',
            stickiness: 0,
            ...creature,
          }),
        );
      }
      delete loadedState.stickiness;
      return { ...initialState, ...loadedState };
    },
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
    setStickiness: (state, action) => {
      const value = parseInt(action.payload, 10);
      if (!isNaN(value)) {
        state.stickiness = Math.max(0, Math.min(10, value));
      }
    },
    setEntities: (state, action) => {
      // Ensure every creature object has the isReachable flag.
      // This makes the state shape consistent and prevents errors if the
      // creatureMonitor ever fails to provide the flag.
      state.creatures = (action.payload || []).map((creature) => ({
        ...creature,
        isReachable: creature.isReachable || false,
      }));
    },
    setTarget: (state, action) => {
      state.target = action.payload;
    },
    addCreatureToTargetingList: (state, action) => {
      const { id, name, stance, distance } = action.payload;
      state.targetingList.push({
        id,
        name,
        stance,
        distance,
        priority: 0,
        action: 'Attack',
        healthRange: 'Any',
        stickiness: 2,
      });
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
        if (updates.priority !== undefined) {
          updates.priority = parseInt(updates.priority, 10) || 0;
        }
        if (updates.distance !== undefined) {
          updates.distance = parseInt(updates.distance, 10) || 0;
        }
        if (updates.stickiness !== undefined) {
          updates.stickiness = parseInt(updates.stickiness, 10) || 0;
        }
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
  setStickiness,
  setEntities,
  setTarget,
  addCreatureToTargetingList,
  removeCreatureFromTargetingList,
  updateCreatureInTargetingList,
} = targetingSlice.actions;

export default targetingSlice;
