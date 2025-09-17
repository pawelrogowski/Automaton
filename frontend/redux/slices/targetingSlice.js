// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/targetingSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
  useBattleList: true,
  // The shape of a creature object now includes instanceId and isReachable
  creatures: [], // [{ instanceId, name, healthTag, absoluteCoords, gameCoords, distance, isReachable }]
  target: null, // { instanceId, name, distanceFrom, ... }
  targetingList: [],
  creatureUpdateMs: 0,
  isPausedByScript: false,
  pauseTimerId: null,
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
    const { creatures, duration } = action.payload;
    // Ensure every creature object has the isReachable flag.
    // This makes the state shape consistent and prevents errors if the
    // creatureMonitor ever fails to provide the flag.
    state.creatures = (creatures || []).map((creature) => ({
      ...creature,
      isReachable: creature.isReachable || false,
    }));
    if (duration) {
      state.creatureUpdateMs = duration;
    }
  },
  // --- START: MODIFICATION ---
  setTarget: (state, action) => {
      const newTarget = action.payload;
      if (newTarget) {
        // When a target is set, create a new object that includes all of its original
        // properties, and adds the 'distanceFrom' key, populated from 'distance'.
        state.target = {
          ...newTarget,
          distanceFrom: newTarget.distance,
        };
      } else {
        // If the payload is null, clear the target.
        state.target = null;
      }
    },
    // --- END: MODIFICATION ---
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
    setScriptPause: (state, action) => {
      state.isPausedByScript = action.payload.isPaused;
      state.pauseTimerId = action.payload.timerId;
    },
    setUseBattleList: (state, action) => {
      state.useBattleList = action.payload;
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
  setScriptPause,
  setUseBattleList,
} = targetingSlice.actions;

export const setTargetingPause = (ms) => (dispatch, getState) => {
  const { pauseTimerId } = getState().targeting;
  if (pauseTimerId) {
    clearTimeout(pauseTimerId);
  }

  if (ms > 0) {
    const timerId = setTimeout(() => {
      dispatch(
        targetingSlice.actions.setScriptPause({
          isPaused: false,
          timerId: null,
        }),
      );
    }, ms);
    dispatch(
      targetingSlice.actions.setScriptPause({ isPaused: true, timerId }),
    );
  } else {
    dispatch(
      targetingSlice.actions.setScriptPause({ isPaused: false, timerId: null }),
    );
  }
};

export default targetingSlice;
