/**
 * A utility to check if two rectangle objects intersect.
 * @param {object} rectA - The first rectangle {x, y, width, height}.
 * @param {object} rectB - The second rectangle {x, y, width, height}.
 * @returns {boolean} True if the rectangles overlap.
 */
function rectsIntersect(rectA, rectB) {
  if (
    !rectA ||
    !rectB ||
    rectA.width <= 0 ||
    rectA.height <= 0 ||
    rectB.width <= 0 ||
    rectB.height <= 0
  ) {
    return false;
  }
  return (
    rectA.x < rectB.x + rectB.width &&
    rectA.x + rectA.width > rectB.x &&
    rectA.y < rectB.y + rectB.height &&
    rectA.y + rectA.height > rectB.y
  );
}

/**
 * Compute area of a rectangle safely.
 */
function rectArea(r) {
  if (!r) return 0;
  const w = Math.max(0, r.width | 0);
  const h = Math.max(0, r.height | 0);
  return w * h;
}

/**
 * Get the intersection rectangle of two rects.
 */
function getIntersection(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 > x1 && y2 > y1) {
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  return null;
}

/**
 * Compute coverage ratio of mergedRects against a region.
 */
function computeCoverageFromMerged(mergedRects, region) {
  if (!region || !mergedRects || mergedRects.length === 0) return 0;
  let sum = 0;
  for (const r of mergedRects) {
    const inter = getIntersection(region, r);
    if (inter) sum += rectArea(inter);
  }
  const total = rectArea(region);
  if (total <= 0) return 0;
  return Math.min(1, sum / total);
}

/**
 * Manages the accumulation and processing of dirty rectangles for a worker.
 * This class encapsulates the logic of collecting, merging, and checking dirty regions
 * to decide if a worker needs to perform its main processing task.
 */
export class FrameUpdateManager {
  /**
   * @param {Array<object>|object} [regionsOfInterest] - An initial region or array of regions to monitor.
   */
  constructor(regionsOfInterest = []) {
    this.accumulatedDirtyRects = [];
    this.setRegionsOfInterest(regionsOfInterest);
  }

  /**
   * Updates the list of regions this manager should monitor for changes.
   * @param {Array<object>|object} regions - A single region object or an array of region objects.
   */
  setRegionsOfInterest(regions) {
    this.regionsOfInterest = Array.isArray(regions)
      ? regions.filter(Boolean)
      : [regions].filter(Boolean);
  }

  /**
   * Adds new dirty rectangles to the internal accumulator.
   * This should be called from the worker's message handler for 'frame-update' events.
   * @param {Array<object>} rects - An array of dirty rectangles from the capture worker.
   */
  addDirtyRects(rects) {
    if (rects && rects.length > 0) {
      this.accumulatedDirtyRects.push(...rects);
    }
  }

  /**
   * Merges an array of rectangles into a smaller set of larger, non-overlapping rectangles.
   * This is a performance optimization to reduce the number of intersection checks.
   * @param {Array<Object>} rects - Array of {x, y, width, height}.
   * @returns {Array<Object>} A new array of merged rectangles.
   * @private
   */
  _mergeRects(rects) {
    if (rects.length < 2) {
      return rects;
    }

    const merged = [];
    let currentRects = [...rects];

    while (currentRects.length > 0) {
      let base = currentRects.shift();
      let i = 0;
      while (i < currentRects.length) {
        const other = currentRects[i];
        // Check for intersection or adjacency
        if (
          base.x < other.x + other.width &&
          base.x + base.width > other.x &&
          base.y < other.y + other.height &&
          base.y + base.height > other.y
        ) {
          const minX = Math.min(base.x, other.x);
          const minY = Math.min(base.y, other.y);
          const maxX = Math.max(base.x + base.width, other.x + other.width);
          const maxY = Math.max(base.y + base.height, other.y + other.height);
          base = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
          currentRects.splice(i, 1); // Remove the merged rect
          i = 0; // Restart the inner loop
        } else {
          i++;
        }
      }
      merged.push(base);
    }
    return merged;
  }

  /**
   * Determines if the worker should perform its main processing logic.
   * This method checks if any accumulated dirty rectangles intersect with the
   * worker's regions of interest. It also handles clearing the accumulator.
   * @returns {boolean} True if processing is needed, false otherwise.
   */
  shouldProcess() {
    if (this.accumulatedDirtyRects.length === 0) {
      return false;
    }

    // Atomically grab and clear the accumulated rects
    const rectsToProcess = [...this.accumulatedDirtyRects];
    this.accumulatedDirtyRects.length = 0;

    // If the worker hasn't defined any specific regions, any change should trigger processing.
    if (this.regionsOfInterest.length === 0) {
      return true;
    }

    const mergedRects = this._mergeRects(rectsToProcess);

    // Coverage threshold (default: 95%)
    const MOVING_COVERAGE_THRESHOLD = 0.95;

    for (const region of this.regionsOfInterest) {
      const coverage = computeCoverageFromMerged(mergedRects, region);
      if (coverage >= MOVING_COVERAGE_THRESHOLD) {
        return true; // Region sufficiently covered by updates
      }
    }

    return false; // No relevant changes found
  }
}
