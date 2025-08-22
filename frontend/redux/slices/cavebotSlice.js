// /home/feiron/Dokumenty/Automaton/frontend/redux/slices/cavebotSlice.js
// --- SIMPLIFIED VERSION ---

import { createSlice } from '@reduxjs/toolkit';

const MAX_WAYPOINTS_PER_SECTION = 1000;

const parseLegacyCoordinates = (payload) => {
  if (typeof payload.coordinates === 'string') {
    const newPayload = { ...payload };
    const coords = newPayload.coordinates.split(',');
    coords.forEach((coord) => {
      const [key, value] = coord.split(':');
      if (key && value) {
        newPayload[key.trim()] = parseInt(value.trim(), 10);
      }
    });
    delete newPayload.coordinates;
    return newPayload;
  }
  return payload;
};

const initialState = {
  enabled: false,
  wptId: 'null',
  wptSelection: null,
  currentSection: 'default',
  standTime: 0,
  isActionPaused: false,
  scriptFeedback: null,
  waypointSections: {
    default: {
      name: 'Default',
      waypoints: [],
    },
  },
  specialAreas: [],
  pathfinderMode: 'cavebot', // 'cavebot' or 'targeting'
  dynamicTarget: null, // Holds {stance, distance, targetCreaturePos} for targeting mode
};

const cavebotSlice = createSlice({
  name: 'cavebot',
  initialState,
  reducers: {
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
    setActionPaused: (state, action) => {
      state.isActionPaused = action.payload;
    },
    setwptId: (state, action) => {
      const newWptId = action.payload;
      if (state.wptId !== newWptId) {
        state.wptId = newWptId;
        // Note: Path feedback is no longer cleared here, as it lives in a different slice.
      }
    },
    setwptSelection: (state, action) => {
      state.wptSelection = action.payload;
    },
    setState: (state, action) => {
      return { ...initialState, ...(action.payload || {}) };
    },
    setStandTime: (state, action) => {
      state.standTime = action.payload;
    },
    setScriptFeedback: (state, action) => {
      state.scriptFeedback = action.payload;
    },
    addWaypoint: (state, action) => {
      const currentWaypoints =
        state.waypointSections[state.currentSection].waypoints;
      if (currentWaypoints.length >= MAX_WAYPOINTS_PER_SECTION) {
        console.warn('Waypoint limit reached for this section.');
        return;
      }

      const parsedPayload = parseLegacyCoordinates(action.payload);
      const newWaypoint = {
        type: 'Node',
        label: '',
        x: 0,
        y: 0,
        z: 0,
        range: 5,
        script: '',
        log: [],
        ...parsedPayload,
        id: action.payload.id,
      };

      const selectedIndex = currentWaypoints.findIndex(
        (waypoint) => waypoint.id === state.wptSelection,
      );
      let newWaypointIndex;
      if (selectedIndex > -1) {
        newWaypointIndex = selectedIndex + 1;
        currentWaypoints.splice(newWaypointIndex, 0, newWaypoint);
      } else {
        currentWaypoints.push(newWaypoint);
        newWaypointIndex = currentWaypoints.length - 1;
      }
      if (currentWaypoints[newWaypointIndex]) {
        state.wptSelection = currentWaypoints[newWaypointIndex].id;
      }
    },
    addWaypointLogEntry: (state, action) => {
      const { id, message } = action.payload;
      const section = state.waypointSections[state.currentSection];
      if (!section) return;

      const waypoint = section.waypoints.find((wp) => wp.id === id);
      if (waypoint) {
        if (!Array.isArray(waypoint.log)) {
          waypoint.log = [];
        }
        const now = new Date();
        const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(3, '0')}`;
        waypoint.log.push(`[${timestamp}] ${message}`);

        const MAX_LOG_SIZE = 100;
        if (waypoint.log.length > MAX_LOG_SIZE) {
          waypoint.log.splice(0, waypoint.log.length - MAX_LOG_SIZE);
        }
      }
    },
    removeWaypoint: (state, action) => {
      const idToRemove = action.payload;
      const currentWaypoints =
        state.waypointSections[state.currentSection].waypoints;
      const indexToRemove = currentWaypoints.findIndex(
        (waypoint) => waypoint.id === idToRemove,
      );
      if (indexToRemove === -1) return;
      const isRemovingSelected = state.wptSelection === idToRemove;
      currentWaypoints.splice(indexToRemove, 1);

      if (isRemovingSelected) {
        if (currentWaypoints.length === 0) {
          state.wptSelection = null;
        } else if (indexToRemove > 0) {
          state.wptSelection = currentWaypoints[indexToRemove - 1].id;
        } else {
          state.wptSelection = currentWaypoints[0].id;
        }
      }
    },
    reorderWaypoints: (state, action) => {
      const { startIndex, endIndex } = action.payload;
      const currentWaypoints =
        state.waypointSections[state.currentSection].waypoints;
      const [removed] = currentWaypoints.splice(startIndex, 1);
      currentWaypoints.splice(endIndex, 0, removed);
    },
    updateWaypoint: (state, action) => {
      const { id, updates } = action.payload;
      const existingWaypoint = state.waypointSections[
        state.currentSection
      ].waypoints.find((waypoint) => waypoint.id === id);
      if (existingWaypoint) {
        const parsedUpdates = parseLegacyCoordinates(updates);
        Object.assign(existingWaypoint, parsedUpdates);
      }
    },
    addWaypointSection: (state, action) => {
      const { id, name } = action.payload;
      if (!state.waypointSections[id]) {
        state.waypointSections[id] = { name, waypoints: [] };
        state.currentSection = id;
      }
    },
    removeWaypointSection: (state, action) => {
      const idToRemove = action.payload;
      if (idToRemove === 'default') return;
      if (state.waypointSections[idToRemove]) {
        delete state.waypointSections[idToRemove];
        if (state.currentSection === idToRemove) {
          state.currentSection =
            Object.keys(state.waypointSections)[0] || 'default';
          if (!state.waypointSections[state.currentSection]) {
            state.waypointSections['default'] = {
              name: 'Default',
              waypoints: [],
            };
            state.currentSection = 'default';
          }
        }
      }
    },
    setCurrentWaypointSection: (state, action) => {
      const sectionId = action.payload;
      if (state.waypointSections[sectionId]) {
        state.currentSection = sectionId;
        state.wptSelection = null;
        state.wptId = 'null';
      }
    },
    renameWaypointSection: (state, action) => {
      const { id, name } = action.payload;
      if (state.waypointSections[id]) {
        state.waypointSections[id].name = name;
      }
    },
    addSpecialArea: (state, action) => {
      const newArea = {
        name: `Area ${state.specialAreas.length + 1}`,
        x: 0,
        y: 0,
        z: 0,
        sizeX: 1,
        sizeY: 1,
        avoidance: 100, // Standardized default avoidance cost
        type: 'cavebot',
        enabled: true,
        ...action.payload,
      };
      if (!newArea.id) return;
      if (state.specialAreas.some((area) => area.id === newArea.id)) return;
      if (state.specialAreas.some((area) => area.name === newArea.name)) return;
      state.specialAreas.push(newArea);
    },
    removeSpecialArea: (state, action) => {
      state.specialAreas = state.specialAreas.filter(
        (area) => area.id !== action.payload,
      );
    },
    updateSpecialArea: (state, action) => {
      const { id, updates } = action.payload;
      const existingArea = state.specialAreas.find((area) => area.id === id);
      if (existingArea) {
        if (
          updates.name &&
          state.specialAreas.some(
            (area) => area.id !== id && area.name === updates.name,
          )
        ) {
          delete updates.name;
        }
        Object.assign(existingArea, updates);
      }
    },
    setPathfinderMode: (state, action) => {
      state.pathfinderMode = action.payload;
    },
    setDynamicTarget: (state, action) => {
      state.dynamicTarget = action.payload;
    },
  },
});

export const {
  setenabled,
  setState,
  setwptId,
  setwptSelection,
  setStandTime,
  setScriptFeedback,
  addWaypoint,
  addWaypointLogEntry,
  removeWaypoint,
  reorderWaypoints,
  updateWaypoint,
  addWaypointSection,
  removeWaypointSection,
  setCurrentWaypointSection,
  renameWaypointSection,
  addSpecialArea,
  removeSpecialArea,
  updateSpecialArea,
  setActionPaused,
  setPathfinderMode,
  setDynamicTarget,
} = cavebotSlice.actions;

export { MAX_WAYPOINTS_PER_SECTION };

export default cavebotSlice;
