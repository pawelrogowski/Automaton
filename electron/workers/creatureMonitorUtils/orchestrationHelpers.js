// Orchestration helpers for creatureMonitor
// -----------------------------------------
// These helpers implement high-level steps for ["creatureMonitor.js"](electron/workers/creatureMonitor.js):
// - list OCR + emission
// - health bar gating + scanning + emission
//
// IMPORTANT:
// - This file MUST NOT import from electron/constants or electron/utils directly.
//   Those paths are resolved in creatureMonitor.js and passed in as arguments.
// - All imports here are relative within creatureMonitorUtils/* only.
// - This avoids incorrect paths like workers/constants/* and keeps dependency
//   direction clear: orchestrator helpers are parameterized, not globally bound.

import {
  jsonEqualsAndCache,
  shouldRefreshRegionForDirtyRects,
  projectHealthBarToTileCoords,
} from './helpers.js';

// Wrap font-ocr recognizeText with safety (pure wrapper)
export const createSafeRecognizeText = (rawRecognizeText) => (...args) => {
  try {
    return rawRecognizeText(...args);
  } catch (err) {
    console.error('[CreatureMonitor] recognizeText error:', err);
    return [];
  }
};

// Compute which list regions need refresh for this frame
export const computeListRefreshFlags = (regions, dirtyRects) => {
  const { battleList, playerList, npcList } = regions || {};
  const battleEntriesRegion = battleList?.children?.entries;

  return {
    shouldRefreshBattleList:
      !!battleEntriesRegion &&
      shouldRefreshRegionForDirtyRects(battleEntriesRegion, dirtyRects),
    shouldRefreshPlayerList:
      !!playerList &&
      shouldRefreshRegionForDirtyRects(playerList, dirtyRects),
    shouldRefreshNpcList:
      !!npcList &&
      shouldRefreshRegionForDirtyRects(npcList, dirtyRects),
  };
};

// OCR battle list entries for given regionCoordinates
// Dependencies are injected to avoid wrong import paths.
export const readBattleListEntriesForRegions = (
  sharedBufferView,
  recognizeTextFn,
  allowedChars,
  regionDefinitions,
) => (regionCoordinates) => {
  if (!regionCoordinates || !regionCoordinates.regions) return [];
  const { regions } = regionCoordinates;
  const entriesRegion = regions.battleList?.children?.entries;
  if (!entriesRegion) return [];

  const ocrResults =
    recognizeTextFn(
      sharedBufferView,
      entriesRegion,
      regionDefinitions.battleList?.ocrColors || [],
      allowedChars,
    ) || [];

  const entries = [];
  for (const result of ocrResults) {
    if (!result || typeof result.text !== 'string') continue;
    let name = result.text.trim();
    if (!name) continue;

    name = name.replace(/\u2026/g, '...').trim();
    name = name.replace(/\.{1,}$/g, '').trim();
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) continue;

    entries.push({
      name,
      x: result.click?.x ?? 0,
      y: result.click?.y ?? 0,
    });
  }

  return entries;
};

// Emit battle list updates with dedup
export const emitBattleListIfChanged = (entries) => ({
  lastPosted,
  lastBattleListEntries,
  parentPortRef,
}) => {
  if (jsonEqualsAndCache(lastPosted, 'battleListEntries', entries)) return;

  lastBattleListEntries.value = entries;

  parentPortRef.postMessage({
    storeUpdate: true,
    type: 'battleList/setBattleListEntries',
    payload: entries,
  });

  if (entries.length > 0) {
    parentPortRef.postMessage({
      storeUpdate: true,
      type: 'battleList/updateLastSeenMs',
      payload: undefined,
    });
  }
};

// Emit players/npcs updates with dedup
export const emitPlayersAndNpcsIfChanged = (players, npcs) => ({
  lastPosted,
  lastPlayerNames,
  lastNpcNames,
  parentPortRef,
}) => {
  if (!jsonEqualsAndCache(lastPosted, 'playerNames', players)) {
    lastPlayerNames.value = players;
    parentPortRef.postMessage({
      storeUpdate: true,
      type: 'uiValues/setPlayers',
      payload: players,
    });
    if (players.length > 0) {
      parentPortRef.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenPlayerMs',
        payload: undefined,
      });
    }
  }

  if (!jsonEqualsAndCache(lastPosted, 'npcNames', npcs)) {
    lastNpcNames.value = npcs;
    parentPortRef.postMessage({
      storeUpdate: true,
      type: 'uiValues/setNpcs',
      payload: npcs,
    });
    if (npcs.length > 0) {
      parentPortRef.postMessage({
        storeUpdate: true,
        type: 'uiValues/updateLastSeenNpcMs',
        payload: undefined,
      });
    }
  }
};

// Emit healthBars with dedup + SAB write
export const emitHealthBarsIfChanged = (tiles, sabInterface) => ({
  lastPosted,
  lastHealthBarTiles,
  parentPortRef,
}) => {
  if (jsonEqualsAndCache(lastPosted, 'healthBars', tiles)) return;

  lastHealthBarTiles.value = tiles;

  try {
    if (sabInterface) {
      sabInterface.set('healthBars', tiles);
    }
  } catch (err) {
    console.error('[CreatureMonitor] Failed to write healthBars to SAB:', err);
  }

  parentPortRef.postMessage({
    storeUpdate: true,
    type: 'targeting/setHealthBars',
    payload: tiles,
  });
};

// Read player position from SAB (best-effort)
export const readPlayerPos = (sabInterface) => ({ lastPlayerPos }) => {
  if (!sabInterface) return lastPlayerPos.value;
  try {
    const res = sabInterface.get('playerPos');
    if (res && res.data && typeof res.data.x === 'number') {
      lastPlayerPos.value = {
        x: res.data.x,
        y: res.data.y,
        z: res.data.z,
      };
    }
  } catch (err) {
    console.error('[CreatureMonitor] Failed to read playerPos from SAB:', err);
  }
  return lastPlayerPos.value;
};

// Decide if health bars should be scanned this frame based on lists and dirty rects
export const shouldScanAndRefreshHealthBars = (
  battleListEntries,
  playerNames,
  gameWorldRegion,
  dirtyRects,
) => {
  const hasEntities =
    (battleListEntries && battleListEntries.length > 0) ||
    (playerNames && playerNames.length > 0);

  if (!hasEntities) return false;
  return shouldRefreshRegionForDirtyRects(gameWorldRegion, dirtyRects);
};

// Scan health bars for gameWorld and return projected tiles
// getGameCoordinatesFromScreenFn is injected from creatureMonitor.js to avoid direct imports here.
export const scanHealthBarsForGameWorld = async (
  sharedBufferView,
  gameWorld,
  tileSize,
  playerPos,
  findHealthBarsModule,
  getGameCoordinatesFromScreenFn,
) => {
  let rawHealthBars = [];
  try {
    rawHealthBars = await findHealthBarsModule.findHealthBars(
      sharedBufferView,
      gameWorld,
    );
  } catch (err) {
    console.error('[CreatureMonitor] findHealthBars error:', err);
    rawHealthBars = [];
  }

  const tiles = [];
  if (Array.isArray(rawHealthBars)) {
    for (const hb of rawHealthBars) {
      const tile = projectHealthBarToTileCoords(
        hb,
        gameWorld,
        tileSize,
        playerPos,
        getGameCoordinatesFromScreenFn,
      );
      if (!tile) continue;
      if (
        tile.x === playerPos.x &&
        tile.y === playerPos.y &&
        tile.z === playerPos.z
      ) {
        continue;
      }
      tiles.push(tile);
    }
  }
  return tiles;
};