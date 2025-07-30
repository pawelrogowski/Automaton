// @electron/workers/region/processing.js
import findSequences from 'find-sequences-native';
import regionDefinitions from '../../constants/regionDefinitions.js';
import * as config from './config.js';
import { DirtyRectManager } from './dirtyRectManager.js';
import { RegionState } from './regionState.js';

/**
 * Check if a point is within a given area.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} area - Area to check against
 * @returns {boolean} True if point is within area
 */
function isPointInArea(x, y, area) {
  return (
    x >= area.x &&
    x < area.x + area.width &&
    y >= area.y &&
    y < area.y + area.height
  );
}

/**
 * Check if a rectangle is within or intersects a given area.
 * @param {Object} rect - Rectangle to check
 * @param {Object} area - Area to check against
 * @returns {boolean} True if rectangle intersects area
 */
function isRectInArea(rect, area) {
  return !(
    rect.x + rect.width < area.x ||
    rect.x > area.x + area.width ||
    rect.y + rect.height < area.y ||
    rect.y > area.y + area.height
  );
}

/**
 * Recursively finds UI regions based on sequence definitions.
 * This is the core engine for locating elements on the screen.
 */
async function findRegionsRecursive(
  buffer,
  definitions,
  searchArea,
  baseOffset,
  parentResult,
  metadata,
  isFullScan = false,
) {
  const discoveryTasks = {};
  const boundingBoxDefs = {};
  const fixedDefs = {};
  const defEntries = Object.entries(definitions);

  if (defEntries.length === 0) return;

  // Step 1: Categorize definitions and build initial search tasks.
  for (const [name, def] of defEntries) {
    switch (def.type) {
      case 'single':
        discoveryTasks[name] = {
          sequences: { [name]: def },
          searchArea,
          occurrence: 'first',
        };
        break;
      case 'boundingBox':
        discoveryTasks[`${name}_start`] = {
          sequences: { [`${name}_start`]: def.start },
          searchArea,
          occurrence: 'first',
        };
        boundingBoxDefs[name] = def;
        break;
      case 'fixed':
        fixedDefs[name] = def;
        break;
    }
  }

  // Process fixed regions immediately as they don't require searching.
  for (const [name, def] of Object.entries(fixedDefs)) {
    // For full scans, always include fixed regions
    // For partial scans, only include if they're within the search area
    if (isFullScan || isRectInArea(def, searchArea)) {
      parentResult[name] = {
        x: baseOffset.x + def.x,
        y: baseOffset.y + def.y,
        width: def.width,
        height: def.height,
      };
    }
  }

  if (!Object.keys(discoveryTasks).length) return;

  // Step 2: Run the initial discovery search for all start markers and single regions.
  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  // Step 3: Process results for 'single' type regions.
  for (const [name, def] of defEntries) {
    if (def.type === 'single' && discoveryResults[name]?.[name]) {
      const result = discoveryResults[name][name];

      // For partial scans, check if the result is within the search area
      if (!isFullScan && !isPointInArea(result.x, result.y, searchArea)) {
        continue;
      }

      const region = {
        x: result.x,
        y: result.y,
        width: def.width,
        height: def.height,
        rawPos: {
          x: result.x - (def.offset?.x || 0),
          y: result.y - (def.offset?.y || 0),
        },
      };

      parentResult[name] = region;

      if (def.children) {
        parentResult[name].children = {};
        childInvocations.push(() =>
          findRegionsRecursive(
            buffer,
            def.children,
            region,
            region,
            parentResult[name].children,
            metadata,
            isFullScan,
          ),
        );
      }
    }
  }

  // Step 4: Prepare endpoint searches for bounding boxes where a start marker was found.
  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (startResult) {
      // For partial scans, check if the result is within the search area
      if (
        !isFullScan &&
        !isPointInArea(startResult.x, startResult.y, searchArea)
      ) {
        continue;
      }

      foundStarts[name] = startResult;

      const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
      const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

      const endSearchArea = {
        x: startResult.x,
        y: startResult.y,
        width: Math.min(maxW, searchArea.x + searchArea.width - startResult.x),
        height: Math.min(
          maxH,
          searchArea.y + searchArea.height - startResult.y,
        ),
      };

      if (endSearchArea.width > 0 && endSearchArea.height > 0) {
        endpointTasks[`${name}_end`] = {
          sequences: { [`${name}_end`]: def.end },
          searchArea: endSearchArea,
          occurrence: 'first',
        };
      }
    }
  }

  // Step 5: Run the endpoint search if any start markers were found.
  const endpointResults =
    Object.keys(endpointTasks).length > 0
      ? await findSequences.findSequencesNativeBatch(buffer, endpointTasks)
      : {};

  // Step 6: Assemble the final bounding box regions.
  for (const [name, startPos] of Object.entries(foundStarts)) {
    const def = boundingBoxDefs[name];
    const endPos = endpointResults[`${name}_end`]?.[`${name}_end`];

    const rawStartPos = {
      x: startPos.x - (def.start.offset?.x || 0),
      y: startPos.y - (def.start.offset?.y || 0),
    };

    if (!endPos) {
      parentResult[name] = {
        ...startPos,
        width: 0,
        height: 0,
        startFound: true,
        endFound: false,
        rawStartPos,
      };
      continue;
    }

    const region = {
      ...startPos,
      width: Math.max(0, endPos.x - startPos.x + 1),
      height: Math.max(0, endPos.y - startPos.y + 1),
      startFound: true,
      endFound: true,
      rawStartPos,
      rawEndPos: {
        x: endPos.x - (def.end.offset?.x || 0),
        y: endPos.y - (def.end.offset?.y || 0),
      },
    };

    parentResult[name] = region;

    if (def.children) {
      parentResult[name].children = {};
      childInvocations.push(() =>
        findRegionsRecursive(
          buffer,
          def.children,
          region,
          region,
          parentResult[name].children,
          metadata,
          isFullScan,
        ),
      );
    }
  }

  // Step 7: Recursively process any child regions in parallel.
  if (childInvocations.length > 0)
    await Promise.all(childInvocations.map((invoke) => invoke()));
}

/**
 * Generates pixel check tasks for all potential battle list entries.
 */
function generateBattleListTasks(entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (config.BATTLE_LIST_ENTRY_VERTICAL_PITCH -
        config.BATTLE_LIST_ENTRY_HEIGHT)) /
      config.BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );

  if (maxEntries <= 0) return null;

  const pixelChecks = { '#FF0000': [], '#FF8080': [], '#000000': [] };

  for (let i = 0; i < maxEntries; i++) {
    const y = entriesRegion.y + i * config.BATTLE_LIST_ENTRY_VERTICAL_PITCH;
    const x = entriesRegion.x;

    pixelChecks['#FF0000'].push({ x, y, id: `entry_${i}_isTargeted_red` });
    pixelChecks['#FF8080'].push({ x, y, id: `entry_${i}_isTargeted_hovered` });
    pixelChecks['#000000'].push({ x, y, id: `entry_${i}_isAttacking_0_0` });
    pixelChecks['#000000'].push({
      x: x + 1,
      y: y + 1,
      id: `entry_${i}_isAttacking_1_1`,
    });
    pixelChecks['#000000'].push({
      x: x + 22,
      y: y + 15,
      id: `entry_${i}_isValid`,
    });
  }

  return { searchArea: entriesRegion, pixelChecks };
}

/**
 * Processes the results of the battle list pixel checks into a structured list.
 */
function processBattleListResults(checkResults, entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (config.BATTLE_LIST_ENTRY_VERTICAL_PITCH -
        config.BATTLE_LIST_ENTRY_HEIGHT)) /
      config.BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );

  const entryList = [];

  if (!checkResults || maxEntries <= 0) {
    entriesRegion.list = [];
    return;
  }

  for (let i = 0; i < maxEntries; i++) {
    if (checkResults[`entry_${i}_isValid`]) {
      const y = entriesRegion.y + i * config.BATTLE_LIST_ENTRY_VERTICAL_PITCH;
      const x = entriesRegion.x;

      entryList.push({
        isValid: true,
        isTargeted:
          !!checkResults[`entry_${i}_isTargeted_red`] ||
          !!checkResults[`entry_${i}_isTargeted_hovered`],
        isAttacking:
          !!checkResults[`entry_${i}_isAttacking_0_0`] ||
          !!checkResults[`entry_${i}_isAttacking_1_1`],
        name: { x: x + 22, y: y + 2, width: 131, height: 12 },
        healthBarFull: { x: x + 22, y: y + 15, width: 132, height: 5 },
        healthBarFill: { x: x + 23, y: y + 16, width: 130, height: 3 },
      });
    }
  }

  entriesRegion.list = entryList;
}

/**
 * Post-processes found regions to add dynamic data like battle list entries and tile size.
 */
async function processSpecialRegions(buffer, regions, metadata) {
  if (regions.battleList?.children?.entries?.endFound) {
    const battleListTask = generateBattleListTasks(
      regions.battleList.children.entries,
    );

    if (battleListTask) {
      const results = await findSequences.findSequencesNativeBatch(buffer, {
        battleListChecks: battleListTask,
      });

      processBattleListResults(
        results.battleListChecks,
        regions.battleList.children.entries,
      );
    }
  }

  if (regions.gameWorld?.endFound) {
    regions.tileSize = {
      width: Math.round(regions.gameWorld.width / 15),
      height: Math.round(regions.gameWorld.height / 11),
    };
  }
}

/**
 * Performs a full scan of the entire screen for all region definitions.
 */
async function performFullScan(buffer, metadata) {
  const foundRegions = {};

  await findRegionsRecursive(
    buffer,
    regionDefinitions,
    { x: 0, y: 0, width: metadata.width, height: metadata.height },
    { x: 0, y: 0 },
    foundRegions,
    metadata,
    true, // isFullScan
  );

  await processSpecialRegions(buffer, foundRegions, metadata);

  return foundRegions;
}

/**
 * Performs a partial scan of only the dirty regions.
 */
async function performPartialScan(
  buffer,
  metadata,
  dirtyRects,
  lastKnownRegions,
) {
  // If there are no dirty rectangles, return null
  if (!dirtyRects || dirtyRects.length === 0) {
    return null;
  }

  // Create a copy of the last known regions
  const newRegionsState = JSON.parse(JSON.stringify(lastKnownRegions));

  // Determine which regions might be affected by the dirty rectangles
  const potentiallyAffectedRegions = new Set();

  // Add all top-level region names
  for (const name in regionDefinitions) {
    potentiallyAffectedRegions.add(name);
  }

  // For each dirty rectangle, check which regions it intersects
  for (const dirtyRect of dirtyRects) {
    for (const name of potentiallyAffectedRegions) {
      const region = lastKnownRegions[name];

      // If the region doesn't exist in the last known state, it might be a new region
      if (!region) continue;

      // Check if the dirty rectangle intersects with the region
      if (isRectInArea(dirtyRect, region)) {
        // The region is potentially affected, so we need to rescan it
        // Remove it from the new state so it will be rescanned
        delete newRegionsState[name];
      }
    }
  }

  // Create a combined search area that encompasses all dirty rectangles
  let combinedSearchArea = { ...dirtyRects[0] };

  for (let i = 1; i < dirtyRects.length; i++) {
    const rect = dirtyRects[i];
    const x = Math.min(combinedSearchArea.x, rect.x);
    const y = Math.min(combinedSearchArea.y, rect.y);
    const x2 = Math.max(
      combinedSearchArea.x + combinedSearchArea.width,
      rect.x + rect.width,
    );
    const y2 = Math.max(
      combinedSearchArea.y + combinedSearchArea.height,
      rect.y + rect.height,
    );

    combinedSearchArea = {
      x,
      y,
      width: x2 - x,
      height: y2 - y,
    };
  }

  // Only scan the potentially affected regions
  const definitionsToFind = {};

  for (const name of potentiallyAffectedRegions) {
    if (!newRegionsState[name] && regionDefinitions[name]) {
      definitionsToFind[name] = regionDefinitions[name];
    }
  }

  // If there are no regions to find, return the current state
  if (Object.keys(definitionsToFind).length === 0) {
    return null;
  }

  // Perform the partial scan
  await findRegionsRecursive(
    buffer,
    definitionsToFind,
    combinedSearchArea,
    { x: 0, y: 0 },
    newRegionsState,
    metadata,
    false, // isFullScan
  );

  // Process special regions for any that were rescanned
  await processSpecialRegions(buffer, newRegionsState, metadata);

  // Check if the state has actually changed
  if (JSON.stringify(newRegionsState) !== JSON.stringify(lastKnownRegions)) {
    return newRegionsState;
  }

  return null;
}

/**
 * The main processing class that orchestrates the adaptive scanning strategy.
 */
export class RegionProcessor {
  constructor() {
    this.dirtyRectManager = new DirtyRectManager();
    this.regionState = new RegionState();
  }

  /**
   * The main entry point for processing a new frame.
   * @param {Buffer} buffer - The screen capture buffer.
   * @param {object} metadata - Frame metadata (width, height, etc.).
   * @param {Array<object>} newDirtyRects - New dirty rectangles for this frame.
   * @returns {object|null} The new region state if it has changed, otherwise null.
   */
  async process(buffer, metadata, newDirtyRects) {
    // Add new dirty rectangles to the manager
    this.dirtyRectManager.addDirtyRects(newDirtyRects, metadata.frameCounter);

    // Get consolidated dirty rectangles
    const consolidatedDirtyRects = this.dirtyRectManager.getConsolidatedRects(
      metadata.frameCounter,
    );

    // Check if a full scan is needed
    const needsFullScan = this.dirtyRectManager.needsFullScan(
      consolidatedDirtyRects,
      metadata.width,
      metadata.height,
      metadata.timestamp,
    );

    let regions;

    if (needsFullScan) {
      // Perform a full scan
      if (Object.keys(this.regionState.get()).length === 0) {
        console.log('[RegionProcessor] Performing initial full scan.');
      } else {
        console.log('[RegionProcessor] Performing scheduled full scan.');
      }

      regions = await performFullScan(buffer, metadata);
      this.dirtyRectManager.clear();
    } else {
      // Perform a partial scan
      const lastKnownRegions = this.regionState.get();

      if (Object.keys(lastKnownRegions).length === 0) {
        // If we don't have any regions yet, we need to do a full scan
        console.log(
          '[RegionProcessor] No regions known, performing full scan.',
        );
        regions = await performFullScan(buffer, metadata);
        this.dirtyRectManager.clear();
      } else {
        // Perform a partial scan
        regions = await performPartialScan(
          buffer,
          metadata,
          consolidatedDirtyRects,
          lastKnownRegions,
        );
      }
    }

    // Update the region state if we have new regions
    if (regions) {
      this.regionState.update(regions);
      return regions;
    }

    // No changes detected
    return null;
  }
}
