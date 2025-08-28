// /home/feiron/Dokumenty/Automaton/electron/utils/frameUpdateManager.js
/**
 * Manages the accumulation of dirty rectangles for a worker.
 * This class acts as a simple flag. If a worker receives dirty rects,
 * shouldProcess() will return true once and then reset.
 */
export class FrameUpdateManager {
  constructor() {
    this.accumulatedDirtyRects = [];
  }

  /**
   * This is now a no-op, as region interest is handled by the workerManager.
   * It's kept for API compatibility to prevent errors from existing calls.
   * @param {Array<object>|object} regions - Ignored.
   */
  setRegionsOfInterest(regions) {
    // Intentionally empty.
  }

  /**
   * Adds new dirty rectangles to the internal accumulator.
   * @param {Array<object>} rects - An array of dirty rectangles.
   */
  addDirtyRects(rects) {
    if (rects && rects.length > 0) {
      this.accumulatedDirtyRects.push(...rects);
    }
  }

  /**
   * Determines if the worker should perform its main processing logic.
   * Returns true if any dirty rectangles have been accumulated since the last check.
   * This method also clears the accumulator.
   * @returns {boolean} True if processing is needed, false otherwise.
   */
  shouldProcess() {
    if (this.accumulatedDirtyRects.length === 0) {
      return false;
    }
    // Atomically check, clear, and return true.
    this.accumulatedDirtyRects.length = 0;
    return true;
  }
}
