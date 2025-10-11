// /home/feiron/Dokumenty/Automaton/electron/workers/cavebot/helpers/navigation.js

import { postStoreUpdate } from './communication.js';
import { awaitStateChange } from './asyncUtils.js';
import { PATH_STATUS_IDLE } from '../../sharedConstants.js';

/**
 * Finds the current waypoint object from the global state.
 * This function is now a pure "getter" and does not modify state.
 * @param {object} globalState - The full global state object.
 * @returns {object|null} The current waypoint object or null if not found.
 */
export function findCurrentWaypoint(globalState) {
  if (!globalState?.cavebot) return null;
  const { waypointSections, currentSection, wptId } = globalState.cavebot;
  return waypointSections[currentSection]?.waypoints.find(
    (wp) => wp.id === wptId,
  );
}

/**
 * Finds the first valid waypoint in the script, used as a fallback.
 * @param {object} globalState - The full global state object.
 * @returns {object|null} The first valid waypoint or null.
 */
export function findFirstValidWaypoint(globalState) {
  if (!globalState?.cavebot) return null;
  const { waypointSections } = globalState.cavebot;
  const firstSectionWithWaypoints = Object.keys(waypointSections).find(
    (id) => waypointSections[id]?.waypoints?.length > 0,
  );
  if (firstSectionWithWaypoints) {
    const firstWaypoint =
      waypointSections[firstSectionWithWaypoints].waypoints[0];
    if (firstWaypoint) {
      return {
        waypoint: firstWaypoint,
        sectionId: firstSectionWithWaypoints,
      };
    }
  }
  return null;
}

export async function advanceToNextWaypoint(workerState, config, options = {}) {
  const { skipCurrent = false } = options;
  workerState.scriptErrorWaypointId = null;
  workerState.scriptErrorCount = 0;

  const globalState = workerState.globalState;
  if (!globalState?.cavebot) return false;

  const {
    waypointSections,
    currentSection,
    wptId: oldWptId,
    unreachableWaypointIds = [],
  } = globalState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (waypoints.length === 0) return false;

  if (skipCurrent) {
    postStoreUpdate('cavebot/addUnreachableWaypointId', oldWptId);
  }

  const currentIndex = waypoints.findIndex((wp) => wp.id === oldWptId);
  if (currentIndex === -1) return false;

  // Find the next waypoint that is not marked as unreachable
  let nextWpt = null;
  let searchIndex = currentIndex;
  const updatedUnreachableIds = skipCurrent
    ? [...unreachableWaypointIds, oldWptId]
    : unreachableWaypointIds;

  for (let i = 1; i <= waypoints.length; i++) {
    const potentialIndex = (currentIndex + i) % waypoints.length;
    const candidateWpt = waypoints[potentialIndex];
    if (!updatedUnreachableIds.includes(candidateWpt.id)) {
      nextWpt = candidateWpt;
      break;
    }
  }

  if (nextWpt) {
    postStoreUpdate('cavebot/setwptId', nextWpt.id);
    const confirmed = await awaitStateChange(
      () => workerState.globalState,
      (state) => state?.cavebot?.wptId === nextWpt.id,
      config.defaultAwaitStateChangeTimeoutMs,
      config.stateChangePollIntervalMs,
    );
    if (confirmed) {
      workerState.lastProcessedWptId = nextWpt.id;
    }
    return confirmed;
  }
  return false;
}

export const goToLabel = async (label, globalState) => {
  const { waypointSections, currentSection } = globalState.cavebot;
  const targetWaypoint = waypointSections[currentSection].waypoints.find(
    (wpt) => wpt.label === label,
  );
  if (targetWaypoint) {
    postStoreUpdate('cavebot/setwptId', targetWaypoint.id);
  }
};

export const goToSection = async (sectionName, workerState, config) => {
  const { waypointSections } = workerState.globalState.cavebot;
  const foundEntry = Object.entries(waypointSections).find(
    ([, section]) => section.name === sectionName,
  );
  if (foundEntry) {
    const [targetSectionId, targetSection] = foundEntry;
    if (targetSection.waypoints?.length > 0) {
      const firstWpt = targetSection.waypoints[0];
      postStoreUpdate('cavebot/setCurrentWaypointSection', targetSectionId);
      postStoreUpdate('cavebot/setwptId', firstWpt.id);
    } else {
      await advanceToNextWaypoint(workerState, config);
    }
  } else {
    await advanceToNextWaypoint(workerState, config);
  }
};

export const goToWpt = async (index, globalState) => {
  const userIndex = parseInt(index, 10);
  if (isNaN(userIndex) || userIndex < 1) return;
  const arrayIndex = userIndex - 1;
  const { waypointSections, currentSection } = globalState.cavebot;
  const waypoints = waypointSections[currentSection]?.waypoints || [];
  if (arrayIndex < waypoints.length) {
    postStoreUpdate('cavebot/setwptId', waypoints[arrayIndex].id);
  }
};

export const resetInternalState = (workerState, fsm) => {
  if (workerState.fsmState !== 'IDLE') {
    workerState.fsmState = 'IDLE';
    fsm.IDLE.enter();
  }
  // Clear live path data
  workerState.path = [];
  workerState.pathfindingStatus = PATH_STATUS_IDLE;

  // Request a new path from the pathfinder
  workerState.shouldRequestNewPath = true;
  workerState.lastFsmState = null;
};
