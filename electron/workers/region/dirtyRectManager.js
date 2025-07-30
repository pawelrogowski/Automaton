// @electron/workers/dirtyRectManager.js
import * as config from './config.js';

export class DirtyRectManager {
  constructor() {
    this.dirtyRects = [];
    this.lastFullScanTime = 0;
  }

  /**
   * Add new dirty rectangles to the manager.
   * @param {Array} rects - Array of dirty rectangles
   * @param {number} frameCounter - Current frame counter
   */
  addDirtyRects(rects, frameCounter) {
    if (!rects || rects.length === 0) return;

    for (const rect of rects) {
      if (rect && rect.width > 0 && rect.height > 0) {
        this.dirtyRects.push({
          ...rect,
          addedFrame: frameCounter,
          id: `${rect.x}_${rect.y}_${rect.width}_${rect.height}_${frameCounter}`,
        });
      }
    }
  }

  /**
   * Get consolidated dirty rectangles, merging overlapping or nearby ones.
   * @param {number} currentFrame - Current frame counter
   * @returns {Array} Consolidated dirty rectangles
   */
  getConsolidatedRects(currentFrame) {
    // Age out old rectangles
    this.dirtyRects = this.dirtyRects.filter(
      (rect) =>
        currentFrame - rect.addedFrame <= config.DIRTY_RECT_MAX_AGE_FRAMES,
    );

    if (this.dirtyRects.length === 0) return [];

    // Merge overlapping or nearby rectangles for efficiency
    const merged = [];
    const processed = new Set();

    for (let i = 0; i < this.dirtyRects.length; i++) {
      if (processed.has(this.dirtyRects[i].id)) continue;

      let current = { ...this.dirtyRects[i] };
      processed.add(current.id);

      for (let j = i + 1; j < this.dirtyRects.length; j++) {
        if (processed.has(this.dirtyRects[j].id)) continue;

        const other = this.dirtyRects[j];
        if (this.shouldMerge(current, other)) {
          current = this.merge(current, other);
          processed.add(other.id);
        }
      }

      merged.push(current);
    }

    return merged;
  }

  /**
   * Determine if two rectangles should be merged.
   * @param {Object} rect1 - First rectangle
   * @param {Object} rect2 - Second rectangle
   * @returns {boolean} True if rectangles should be merged
   */
  shouldMerge(rect1, rect2) {
    const expandedRect1 = {
      x: rect1.x - config.DIRTY_RECT_MERGE_THRESHOLD,
      y: rect1.y - config.DIRTY_RECT_MERGE_THRESHOLD,
      width: rect1.width + 2 * config.DIRTY_RECT_MERGE_THRESHOLD,
      height: rect1.height + 2 * config.DIRTY_RECT_MERGE_THRESHOLD,
    };

    return !(
      rect2.x > expandedRect1.x + expandedRect1.width ||
      rect2.x + rect2.width < expandedRect1.x ||
      rect2.y > expandedRect1.y + expandedRect1.height ||
      rect2.y + rect2.height < expandedRect1.y
    );
  }

  /**
   * Merge two rectangles.
   * @param {Object} rect1 - First rectangle
   * @param {Object} rect2 - Second rectangle
   * @returns {Object} Merged rectangle
   */
  merge(rect1, rect2) {
    const x = Math.min(rect1.x, rect2.x);
    const y = Math.min(rect1.y, rect2.y);
    const x2 = Math.max(rect1.x + rect1.width, rect2.x + rect2.width);
    const y2 = Math.max(rect1.y + rect1.height, rect2.y + rect2.height);

    return {
      x,
      y,
      width: x2 - x,
      height: y2 - y,
      addedFrame: Math.min(rect1.addedFrame, rect2.addedFrame),
    };
  }

  /**
   * Calculate the percentage of the screen that is dirty.
   * @param {Array} rects - Array of dirty rectangles
   * @param {number} screenWidth - Screen width
   * @param {number} screenHeight - Screen height
   * @returns {number} Percentage of dirty area
   */
  getDirtyAreaPercentage(rects, screenWidth, screenHeight) {
    if (screenHeight === 0 || screenWidth === 0) return 0;

    // Calculate total dirty area, accounting for overlaps
    const totalScreenArea = screenWidth * screenHeight;
    if (totalScreenArea === 0) return 0;

    // Create a grid to mark dirty pixels
    const gridSize = 10; // Use a grid for efficiency
    const gridWidth = Math.ceil(screenWidth / gridSize);
    const gridHeight = Math.ceil(screenHeight / gridSize);
    const dirtyGrid = new Array(gridWidth * gridHeight).fill(false);

    let dirtyCellCount = 0;

    for (const rect of rects) {
      const startX = Math.max(0, Math.floor(rect.x / gridSize));
      const endX = Math.min(
        gridWidth - 1,
        Math.floor((rect.x + rect.width) / gridSize),
      );
      const startY = Math.max(0, Math.floor(rect.y / gridSize));
      const endY = Math.min(
        gridHeight - 1,
        Math.floor((rect.y + rect.height) / gridSize),
      );

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const idx = y * gridWidth + x;
          if (!dirtyGrid[idx]) {
            dirtyGrid[idx] = true;
            dirtyCellCount++;
          }
        }
      }
    }

    return (dirtyCellCount / (gridWidth * gridHeight)) * 100;
  }

  /**
   * Check if a full scan is needed based on time elapsed or dirty area.
   * @param {Array} rects - Array of dirty rectangles
   * @param {number} screenWidth - Screen width
   * @param {number} screenHeight - Screen height
   * @param {number} currentTime - Current timestamp
   * @returns {boolean} True if a full scan is needed
   */
  needsFullScan(rects, screenWidth, screenHeight, currentTime) {
    // Check if enough time has passed since the last full scan
    if (
      currentTime - this.lastFullScanTime >
      config.FULL_SCAN_SAFETY_NET_INTERVAL_MS
    ) {
      this.lastFullScanTime = currentTime;
      return true;
    }

    // Check if the dirty area percentage exceeds the threshold
    const dirtyPercentage = this.getDirtyAreaPercentage(
      rects,
      screenWidth,
      screenHeight,
    );
    if (dirtyPercentage > config.FULL_SCAN_FALLBACK_PERCENTAGE) {
      this.lastFullScanTime = currentTime;
      return true;
    }

    return false;
  }

  /**
   * Clear all dirty rectangles.
   */
  clear() {
    this.dirtyRects = [];
  }
}
