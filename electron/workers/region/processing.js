// @electron/workers/region/processing.js
import findSequences from 'find-sequences-native';
import regionDefinitions from '../../constants/regionDefinitions.js';
import * as config from './config.js';

// --- BattleList Processing Helpers ---
const BATTLE_LIST_ENTRY_HEIGHT = 20;
const BATTLE_LIST_ENTRY_VERTICAL_PITCH = 22;

function generateBattleListTasks(entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (BATTLE_LIST_ENTRY_VERTICAL_PITCH - BATTLE_LIST_ENTRY_HEIGHT)) /
      BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );
  if (maxEntries <= 0) return null;
  const pixelChecks = {
    '#FF0000': [],
    '#FF8080': [],
    '#000000': [],
  };
  for (let i = 0; i < maxEntries; i++) {
    const entryBaseY = entriesRegion.y + i * BATTLE_LIST_ENTRY_VERTICAL_PITCH;
    const entryBaseX = entriesRegion.x;
    pixelChecks['#FF0000'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isTargeted_red`,
    });
    pixelChecks['#FF8080'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isTargeted_hovered`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX,
      y: entryBaseY,
      id: `entry_${i}_isAttacking_0_0`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX + 1,
      y: entryBaseY + 1,
      id: `entry_${i}_isAttacking_1_1`,
    });
    pixelChecks['#000000'].push({
      x: entryBaseX + 22,
      y: entryBaseY + 15,
      id: `entry_${i}_isValid`,
    });
  }
  return { searchArea: entriesRegion, pixelChecks };
}

function processBattleListResults(checkResults, entriesRegion) {
  const maxEntries = Math.floor(
    (entriesRegion.height +
      (BATTLE_LIST_ENTRY_VERTICAL_PITCH - BATTLE_LIST_ENTRY_HEIGHT)) /
      BATTLE_LIST_ENTRY_VERTICAL_PITCH,
  );
  const entryList = [];
  if (!checkResults || maxEntries <= 0) {
    entriesRegion.list = [];
    return;
  }
  for (let i = 0; i < maxEntries; i++) {
    if (checkResults[`entry_${i}_isValid`]) {
      const entryBaseY = entriesRegion.y + i * BATTLE_LIST_ENTRY_VERTICAL_PITCH;
      const entryBaseX = entriesRegion.x;
      entryList.push({
        isValid: true,
        isTargeted:
          !!checkResults[`entry_${i}_isTargeted_red`] ||
          !!checkResults[`entry_${i}_isTargeted_hovered`],
        isAttacking:
          !!checkResults[`entry_${i}_isAttacking_0_0`] ||
          !!checkResults[`entry_${i}_isAttacking_1_1`],
        name: { x: entryBaseX + 22, y: entryBaseY + 2, width: 131, height: 12 },
        healthBarFull: {
          x: entryBaseX + 22,
          y: entryBaseY + 15,
          width: 132,
          height: 5,
        },
        healthBarFill: {
          x: entryBaseX + 23,
          y: entryBaseY + 16,
          width: 130,
          height: 3,
        },
      });
    }
  }
  entriesRegion.list = entryList;
}

/**
 * Find a single sequence in a specific area.
 */
async function findSequence(buffer, sequenceDef, searchArea, sequenceName) {
  if (!sequenceDef || !searchArea || !sequenceName) {
    return null;
  }

  // Ensure sequenceDef has the required properties
  if (!sequenceDef.sequence || !Array.isArray(sequenceDef.sequence)) {
    return null;
  }

  // Create the task structure expected by findSequencesNativeBatch
  const searchTasks = {};
  searchTasks[sequenceName] = {
    sequences: { [sequenceName]: sequenceDef },
    searchArea,
    occurrence: 'first',
  };

  try {
    const results = await findSequences.findSequencesNativeBatch(
      buffer,
      searchTasks,
    );
    return results[sequenceName]?.[sequenceName] || null;
  } catch (error) {
    console.error('[RegionProcessor] Error in findSequence:', error);
    return null;
  }
}

/**
 * Check if a point is within a rectangle.
 */
function isPointInRect(x, y, rect) {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/**
 * Check if a rectangle intersects with another rectangle.
 */
function rectsIntersect(rect1, rect2) {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect1.x > rect2.x + rect2.width ||
    rect1.y + rect1.height < rect2.y ||
    rect1.y > rect2.y + rect2.height
  );
}

/**
 * findRegionsRecursive - Adapted from original working code
 */
async function findRegionsRecursive(
  buffer,
  definitions,
  searchArea,
  baseOffset,
  parentResult,
  metadata,
) {
  const discoveryTasks = {};
  const boundingBoxDefs = {};
  const fixedDefs = {};
  const defEntries = Object.entries(definitions);

  // Step 1: Generate discovery tasks
  for (const [name, def] of defEntries) {
    const type = def.type;
    switch (type) {
      case 'single':
        discoveryTasks[name] = {
          sequences: { [name]: def },
          searchArea,
          occurrence: 'first',
        };
        break;
      case 'boundingBox':
        const startTaskKey = `${name}_start`;
        discoveryTasks[startTaskKey] = {
          sequences: { [startTaskKey]: def.start },
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

  // Process fixed regions
  for (const [name, def] of Object.entries(fixedDefs)) {
    parentResult[name] = {
      x: baseOffset.x + def.x,
      y: baseOffset.y + def.y,
      width: def.width,
      height: def.height,
    };
  }

  if (!Object.keys(discoveryTasks).length) return;

  // Step 2: Run discovery search
  const discoveryResults = await findSequences.findSequencesNativeBatch(
    buffer,
    discoveryTasks,
  );

  const endpointTasks = {};
  const foundStarts = {};
  const childInvocations = [];

  // Step 3: Process 'single' results
  for (const [name, def] of defEntries) {
    if (def.type === 'single' && discoveryResults[name]?.[name]) {
      const result = discoveryResults[name][name];
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
            {
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
            },
            { x: region.x, y: region.y },
            parentResult[name].children,
            metadata,
          ),
        );
      }
    }
  }

  // Step 4: Process bounding boxes
  for (const [name, def] of Object.entries(boundingBoxDefs)) {
    const startResult = discoveryResults[`${name}_start`]?.[`${name}_start`];
    if (!startResult) continue;

    foundStarts[name] = startResult;
    const maxW = def.maxRight === 'fullWidth' ? metadata.width : def.maxRight;
    const maxH = def.maxDown === 'fullHeight' ? metadata.height : def.maxDown;

    const endSearchArea = {
      x: startResult.x,
      y: startResult.y,
      width: Math.min(maxW, searchArea.x + searchArea.width - startResult.x),
      height: Math.min(maxH, searchArea.y + searchArea.height - startResult.y),
    };

    if (endSearchArea.width > 0 && endSearchArea.height > 0) {
      endpointTasks[`${name}_end`] = {
        sequences: { [`${name}_end`]: def.end },
        searchArea: endSearchArea,
        occurrence: 'first',
      };
    }
  }

  // Step 5: Run endpoint search
  let endpointResults = {};
  if (Object.keys(endpointTasks).length > 0) {
    endpointResults = await findSequences.findSequencesNativeBatch(
      buffer,
      endpointTasks,
    );
  }

  // Step 6: Assemble bounding boxes
  for (const [name, startPos] of Object.entries(foundStarts)) {
    const def = boundingBoxDefs[name];
    const endPos = endpointResults[`${name}_end`]?.[`${name}_end`];
    const absStartPos = { x: startPos.x, y: startPos.y };
    const rawStartPos = {
      x: absStartPos.x - (def.start.offset?.x || 0),
      y: absStartPos.y - (def.start.offset?.y || 0),
    };

    if (!endPos) {
      parentResult[name] = {
        ...absStartPos,
        width: 0,
        height: 0,
        startFound: true,
        endFound: false,
        rawStartPos,
      };
      continue;
    }

    const rectWidth = endPos.x - startPos.x + 1;
    const rectHeight = endPos.y - startPos.y + 1;
    const region = {
      ...absStartPos,
      width: rectWidth > 0 ? rectWidth : 0,
      height: rectHeight > 0 ? rectHeight : 0,
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
          {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
          { x: region.x, y: region.y },
          parentResult[name].children,
          metadata,
        ),
      );
    }
  }

  // Step 7: Parallelize child processing
  if (childInvocations.length > 0) {
    await Promise.all(childInvocations.map((invoke) => invoke()));
  }
}

/**
 * Process special regions like battle list and tile size
 */
async function processSpecialRegions(buffer, regions) {
  // Process battle list if its container was found
  if (regions.battleList?.children?.entries?.endFound) {
    const battleListTask = generateBattleListTasks(
      regions.battleList.children.entries,
    );

    if (battleListTask) {
      const batchTask = { battleListChecks: battleListTask };
      const results = await findSequences.findSequencesNativeBatch(
        buffer,
        batchTask,
      );

      processBattleListResults(
        results.battleListChecks,
        regions.battleList.children.entries,
      );
    }
  }

  // Calculate tile size if the game world was found
  if (regions.gameWorld?.endFound) {
    const { gameWorld } = regions;
    regions.tileSize = {
      width: Math.round(gameWorld.width / 15),
      height: Math.round(gameWorld.height / 11),
    };
  }
}

/**
 * Update a bounding box region with optimized vertical-only resizing logic
 */
async function updateBoundingBoxRegion(
  buffer,
  name,
  regionDef,
  currentRegion,
  dirtyRect,
  metadata,
) {
  // Safety check for currentRegion
  if (!currentRegion || typeof currentRegion !== 'object') {
    return null;
  }

  // Check if dirty rectangle intersects with the region
  const regionRect = {
    x: currentRegion.x || 0,
    y: currentRegion.y || 0,
    width: currentRegion.width || 0,
    height: currentRegion.height || 0,
  };

  const intersects = rectsIntersect(regionRect, dirtyRect);

  if (intersects) {
    // First, verify the start sequence is still there
    // Add safety checks for rawStartPos
    let rawStartPos = currentRegion.rawStartPos;
    if (!rawStartPos) {
      // If rawStartPos is missing, we need to recalculate it
      rawStartPos = {
        x: (currentRegion.x || 0) - (regionDef.start.offset?.x || 0),
        y: (currentRegion.y || 0) - (regionDef.start.offset?.y || 0),
      };
    }

    const startSearchArea = {
      x: rawStartPos.x - 10,
      y: rawStartPos.y - 10,
      width: 20,
      height: 20,
    };

    const startResult = await findSequence(
      buffer,
      regionDef.start,
      startSearchArea,
      `${name}_start`,
    );

    if (startResult) {
      // Start sequence found, now look for end sequence
      // OPTIMIZATION: Since resizing is only vertical, we know the X position doesn't change

      // Add safety checks for rawEndPos and width
      let rawEndPos = currentRegion.rawEndPos;
      const regionWidth = currentRegion.width || 0;

      if (!rawEndPos || !regionWidth) {
        // If rawEndPos or width is missing, we need to recalculate
        rawEndPos = {
          x:
            (currentRegion.x || 0) +
            regionWidth -
            (regionDef.end.offset?.x || 0),
          y:
            (currentRegion.y || 0) +
            (currentRegion.height || 0) -
            (regionDef.end.offset?.y || 0),
        };
      }

      const maxH =
        regionDef.maxDown === 'fullHeight'
          ? metadata.height
          : regionDef.maxDown;

      // Create narrow vertical search area at the known X position
      const endSearchArea = {
        x: rawEndPos.x - 10,
        y: startResult.y,
        width: 20,
        height: Math.min(maxH, metadata.height - startResult.y),
      };

      const endResult = await findSequence(
        buffer,
        regionDef.end,
        endSearchArea,
        `${name}_end`,
      );

      if (endResult) {
        // Found both sequences - update region with new height
        return {
          ...startResult,
          width: regionWidth, // Width doesn't change in vertical resize
          height: endResult.y - startResult.y + 1,
          startFound: true,
          endFound: true,
          rawStartPos: {
            x: startResult.x - (regionDef.start.offset?.x || 0),
            y: startResult.y - (regionDef.start.offset?.y || 0),
          },
          rawEndPos: {
            x: endResult.x - (regionDef.end.offset?.x || 0),
            y: endResult.y - (regionDef.end.offset?.y || 0),
          },
        };
      } else {
        // Only found start sequence - keep it but mark end as missing
        // This prevents the region from being lost during fast resizing
        return {
          ...startResult,
          width: regionWidth,
          height: 0,
          startFound: true,
          endFound: false,
          rawStartPos: {
            x: startResult.x - (regionDef.start.offset?.x || 0),
            y: startResult.y - (regionDef.start.offset?.y || 0),
          },
          rawEndPos: rawEndPos, // Keep existing rawEndPos
        };
      }
    } else {
      // Couldn't find start sequence - remove region
      return null;
    }
  }

  // No intersection, no changes needed
  return currentRegion;
}

/**
 * Update a single region
 */
async function updateSingleRegion(
  buffer,
  name,
  regionDef,
  currentRegion,
  dirtyRect,
  metadata,
) {
  // Safety check for currentRegion
  if (!currentRegion || typeof currentRegion !== 'object') {
    return null;
  }

  // Check if the sequence anchor point is in the dirty rect
  // Add safety check for rawPos
  let rawPos = currentRegion.rawPos;
  if (!rawPos) {
    // If rawPos is missing, recalculate it
    rawPos = {
      x: (currentRegion.x || 0) - (regionDef.offset?.x || 0),
      y: (currentRegion.y || 0) - (regionDef.offset?.y || 0),
    };
  }

  if (isPointInRect(rawPos.x, rawPos.y, dirtyRect)) {
    // Look for the sequence in the dirty rect
    const result = await findSequence(buffer, regionDef, dirtyRect, name);

    if (result) {
      return {
        x: result.x,
        y: result.y,
        width: regionDef.width || 0,
        height: regionDef.height || 0,
        rawPos: {
          x: result.x - (regionDef.offset?.x || 0),
          y: result.y - (regionDef.offset?.y || 0),
        },
      };
    }
    return null; // Region disappeared
  }

  // No intersection, no changes needed
  return currentRegion;
}

/**
 * The main processing class.
 */
export class RegionProcessor {
  constructor() {
    this.regions = {}; // Simple object for region state
    this.lastFullScanTime = 0;
  }

  /**
   * Perform a full scan of the entire screen.
   */
  async performFullScan(buffer, metadata) {
    const foundRegions = {};

    try {
      // Always start a fresh recursive search from the top level
      await findRegionsRecursive(
        buffer,
        regionDefinitions,
        { x: 0, y: 0, width: metadata.width, height: metadata.height },
        { x: 0, y: 0 },
        foundRegions,
        metadata,
      );

      // Process special regions
      await processSpecialRegions(buffer, foundRegions);

      this.lastFullScanTime = Date.now();
      return foundRegions;
    } catch (error) {
      console.error('[RegionProcessor] Error during full scan:', error);
      return {};
    }
  }

  /**
   * Update regions based on dirty rectangles.
   */
  async updateRegionsWithDirtyRects(buffer, metadata, dirtyRects) {
    const updatedRegions = { ...this.regions };
    let hasChanges = false;

    // For each dirty rectangle, check if it intersects with any known regions
    for (const dirtyRect of dirtyRects) {
      if (!dirtyRect) continue;

      // Check all known regions
      for (const [name, region] of Object.entries(this.regions)) {
        const regionDef = regionDefinitions[name];

        if (!regionDef) continue;

        if (regionDef.type === 'single') {
          const result = await updateSingleRegion(
            buffer,
            name,
            regionDef,
            region,
            dirtyRect,
            metadata,
          );

          if (result === null) {
            // Region disappeared
            delete updatedRegions[name];
            hasChanges = true;
          } else if (JSON.stringify(result) !== JSON.stringify(region)) {
            // Region changed
            updatedRegions[name] = result;
            hasChanges = true;
          }
        } else if (regionDef.type === 'boundingBox') {
          const result = await updateBoundingBoxRegion(
            buffer,
            name,
            regionDef,
            region,
            dirtyRect,
            metadata,
          );

          if (result === null) {
            // Region disappeared
            delete updatedRegions[name];
            hasChanges = true;
          } else if (JSON.stringify(result) !== JSON.stringify(region)) {
            // Region changed
            updatedRegions[name] = result;
            hasChanges = true;
          }
        }
        // Fixed regions don't need updates
      }

      // Look for new regions in the dirty rectangle
      for (const [name, regionDef] of Object.entries(regionDefinitions)) {
        // Skip if we already know this region
        if (this.regions[name]) continue;

        // Check if the region could fit in the dirty rectangle
        if (regionDef.type === 'single') {
          const seqLength = regionDef.sequence?.length || 0;
          const direction = regionDef.direction || 'horizontal';

          if (
            (direction === 'horizontal' && seqLength <= dirtyRect.width) ||
            (direction === 'vertical' && seqLength <= dirtyRect.height)
          ) {
            // Look for the region in the dirty rectangle
            const result = {};
            await findRegionsRecursive(
              buffer,
              { [name]: regionDef },
              dirtyRect,
              { x: 0, y: 0 },
              result,
              metadata,
            );

            if (result[name]) {
              // Found a new region
              updatedRegions[name] = result[name];
              hasChanges = true;
            }
          }
        } else if (regionDef.type === 'boundingBox') {
          // For bounding box, check if start sequence could fit
          const startSeqLength = regionDef.start?.sequence?.length || 0;
          const startDirection = regionDef.start?.direction || 'horizontal';

          if (
            (startDirection === 'horizontal' &&
              startSeqLength <= dirtyRect.width) ||
            (startDirection === 'vertical' &&
              startSeqLength <= dirtyRect.height)
          ) {
            // Look for the region in the dirty rectangle
            const result = {};
            await findRegionsRecursive(
              buffer,
              { [name]: regionDef },
              dirtyRect,
              { x: 0, y: 0 },
              result,
              metadata,
            );

            if (result[name]) {
              // Found a new region
              updatedRegions[name] = result[name];
              hasChanges = true;
            }
          }
        }
      }
    }

    // Process special regions if there were changes
    if (hasChanges) {
      await processSpecialRegions(buffer, updatedRegions);
    }

    // Update state if there were changes
    if (hasChanges) {
      this.regions = updatedRegions;

      // Create a new object with only found regions (filter out undefined)
      const foundRegions = {};

      // Get all region names and sort them alphabetically
      const sortedRegionNames = Object.keys(updatedRegions).sort();

      // Only include regions that are actually found (not undefined)
      for (const name of sortedRegionNames) {
        if (
          updatedRegions[name] !== undefined &&
          updatedRegions[name] !== null
        ) {
          foundRegions[name] = updatedRegions[name];
        }
      }

      return foundRegions;
    }

    return null; // No changes
  }

  /**
   * Process a frame with dirty rectangles.
   */
  async process(buffer, metadata, dirtyRects) {
    if (!buffer || !metadata || !dirtyRects) {
      return null;
    }

    // If we have no regions or it's been more than 30 seconds since the last full scan, do a full scan
    if (
      Object.keys(this.regions).length === 0 ||
      Date.now() - this.lastFullScanTime > 30000
    ) {
      const regions = await this.performFullScan(buffer, metadata);
      this.regions = regions;

      // Create a sorted object with only found regions
      const foundRegions = {};
      const sortedRegionNames = Object.keys(regions).sort();

      for (const name of sortedRegionNames) {
        if (regions[name] !== undefined && regions[name] !== null) {
          foundRegions[name] = regions[name];
        }
      }

      return foundRegions;
    }

    // Otherwise, update based on dirty rectangles
    return await this.updateRegionsWithDirtyRects(buffer, metadata, dirtyRects);
  }
}
