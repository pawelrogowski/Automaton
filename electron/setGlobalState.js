import store from './store.js';
import { getMainWindow, getWidgetWindow } from './createMainWindow.js';

// Whitelist of action types that the frontend is allowed to receive.
// This includes low-frequency UI actions and essential backend updates.
const RENDERER_STATE_UPDATE_WHITELIST = new Set([
  // gameState
  'gameState/updateGameStateFromMonitorData',
  'gameState/setPlayerMinimapPosition',
  'gameState/setHealthPercent',
  'gameState/setManaPercent',
  'gameState/setCharacterName',
  'gameState/updateCharacterNames',

  // Targeting
  'targeting/setEntities',
  'targeting/setTarget',
  'targeting/setState',

  // Pathfinder
  'pathfinder/setPathfindingFeedback',

  // Cavebot - ALL ACTIONS
  'cavebot/requestTargetingControl',
  'cavebot/confirmTargetingControl',
  'cavebot/releaseTargetingControl',
  'cavebot/setenabled',
  'cavebot/setActionPaused',
  'cavebot/setwptId',
  'cavebot/setwptSelection',
  'cavebot/setState',
  'cavebot/setStandTime',
  'cavebot/setScriptFeedback',
  'cavebot/addWaypoint',
  'cavebot/addWaypointLogEntry',
  'cavebot/removeWaypoint',
  'cavebot/reorderWaypoints',
  'cavebot/updateWaypoint',
  'cavebot/addWaypointSection',
  'cavebot/removeWaypointSection',
  'cavebot/setCurrentWaypointSection',
  'cavebot/renameWaypointSection',
  'cavebot/addSpecialArea',
  'cavebot/removeSpecialArea',
  'cavebot/updateSpecialArea',
  'cavebot/setDynamicTarget',
  'cavebot/addVisitedTile',
  'cavebot/clearVisitedTiles',
  'cavebot/setScriptPause',
  'cavebot/setNodeRange',

  // Lua - ALL ACTIONS
  'lua/clearError',
  'lua/addScript',
  'lua/addLogEntry',
  'lua/clearScriptLog',
  'lua/removeScript',
  'lua/updateScript',
  'lua/togglePersistentScript',
  'lua/setState',
  'lua/setenabled',
  'lua/setScriptEnabledByName',

  // Rules - ALL ACTIONS
  'rules/addRule',
  'rules/removeRule',
  'rules/updateRule',
  'rules/updateCondition',
  'rules/removeCondition',
  'rules/loadRules',
  'rules/setActivePresetIndex',
  'rules/setState',
  'rules/sortRulesBy',
  'rules/copyPreset',
  'rules/setenabled',

  // Global
  'global/setState',
]);

let actionQueue = [];
let isScheduled = false;

function sendBatch() {
  if (actionQueue.length === 0) {
    isScheduled = false;
    return;
  }

  const mainWindow = getMainWindow();
  const widgetWindow = getWidgetWindow();
  const batch = [...actionQueue];
  actionQueue = [];

  // Filter the batch and stamp the origin for the renderer.
  const rendererBatch = batch
    .filter((action) => {
      // If it came from the renderer, always echo it back.
      if (action.origin === 'renderer') {
        return true;
      }
      // If it came from the backend, check the whitelist.
      return RENDERER_STATE_UPDATE_WHITELIST.has(action.type);
    })
    .map((action) => ({
      // Stamp every action going to the renderer as from the backend
      // so the frontend middleware processes it correctly.
      type: action.type,
      payload: action.payload,
      origin: 'backend',
    }));

  if (mainWindow && !mainWindow.isDestroyed() && rendererBatch.length > 0) {
    mainWindow.webContents.send('state-update-batch', rendererBatch);
  }
  if (widgetWindow && !widgetWindow.isDestroyed() && rendererBatch.length > 0) {
    widgetWindow.webContents.send('state-update-batch', rendererBatch);
  }

  isScheduled = false;
}

function scheduleBatch() {
  if (!isScheduled) {
    isScheduled = true;
    setImmediate(sendBatch);
  }
}

/**
 * A centralized function to update the main process Redux store
 * and broadcast the change to the renderer process.
 * @param {string} type - The action type (e.g., 'cavebot/setEnabled').
 * @param {*} payload - The action payload.
 * @param {string} origin - The origin of the action ('renderer' or 'backend').
 */
function setGlobalState(type, payload, origin = 'backend') {
  // 1. Dispatch the action to the main process store immediately.
  // The main store doesn't care about the origin.
  store.dispatch({ type, payload });

  // 2. Queue the action with its origin to be sent to the renderer.
  actionQueue.push({ type, payload, origin });
  scheduleBatch();
}

export default setGlobalState;
