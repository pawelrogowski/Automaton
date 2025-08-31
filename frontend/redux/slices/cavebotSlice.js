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
  controlState: 'CAVEBOT',
  dynamicTarget: null,
  visitedTiles: [],
  waypointIdAtTargetingStart: null,
};

const cavebotSlice = createSlice({
  name: 'cavebot',
  initialState,
  reducers: {
    /**
     * Dispatched by targetingWorker when it finds a target and wants to take control.
     * This initiates the handoff process.
     */
    requestTargetingControl: (state) => {
      if (state.controlState === 'CAVEBOT') {
        state.controlState = 'HANDOVER_TO_TARGETING';
        state.isActionPaused = true;
        state.waypointIdAtTargetingStart = state.wptId; // Set the reference waypoint
      }
    },

    /**
     * Dispatched by cavebotWorker after it has safely finished its current action
     * and cleaned up its internal state in response to the handover request.
     */
    confirmTargetingControl: (state) => {
      // Allow taking control from a handover state OR from an idle/disabled cavebot.
      if (state.controlState === 'HANDOVER_TO_TARGETING' || state.controlState === 'CAVEBOT') {
        state.controlState = 'TARGETING';
      }
    },

    /**
     * Dispatched by targetingWorker when it has no more targets and is relinquishing control.
     * This resets the state back to cavebot operation.
     */
    releaseTargetingControl: (state) => {
      state.controlState = 'CAVEBOT';
      state.dynamicTarget = null;
      // Do NOT clear visitedTiles or waypointIdAtTargetingStart here.
      // CavebotWorker needs them to perform the node skip check upon regaining control.
      state.isActionPaused = false;
    },

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

        const currentWaypoint = Object.values(state.waypointSections)
          .flatMap((section) => section.waypoints)
          .find((waypoint) => waypoint.id === newWptId);

        if (currentWaypoint && currentWaypoint.label) {
          state.lastLabel = currentWaypoint.label;
        }
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
        avoidance: 100,
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
    setDynamicTarget: (state, action) => {
      state.dynamicTarget = action.payload;
    },
    addVisitedTile: (state, action) => {
      const { x, y, z } = action.payload;
      if (
        !state.visitedTiles.some(
          (tile) => tile.x === x && tile.y === y && tile.z === z,
        )
      ) {
        state.visitedTiles.push({ x, y, z });
      }
    },
    /**
     * New reducer dispatched by cavebotWorker after it has checked for a node skip.
     * This cleans up the visited tiles for the next targeting session.
     */
    clearVisitedTiles: (state) => {
      state.visitedTiles = [];
    },
  },
});

export const {
  requestTargetingControl,
  confirmTargetingControl,
  releaseTargetingControl,
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
  setDynamicTarget,
  addVisitedTile,
  clearVisitedTiles, // Export the correctly named action
} = cavebotSlice.actions;

export { MAX_WAYPOINTS_PER_SECTION };

export default cavebotSlice;
