/**
 * A class to track, calculate, and report capture performance statistics.
 */
export class PerformanceTracker {
  constructor() {
    this.reset();
  }

  /**
   * Resets all statistics to their initial state.
   */
  reset() {
    this.frameTimes = [];
    this.totalFrameTime = 0;
    this.minFrameTime = Infinity;
    this.maxFrameTime = 0;

    this.dirtyRegionCounts = [];
    this.totalDirtyRegions = 0;
    this.minDirtyRegions = Infinity;
    this.maxDirtyRegions = 0;
  }

  /**
   * Adds a new frame measurement to the tracker.
   * @param {number} duration - The time in milliseconds for the frame capture loop.
   * @param {number} regionCount - The number of dirty regions in the frame.
   */
  addFrameMeasurement(duration, regionCount) {
    // Frame time stats
    this.frameTimes.push(duration);
    this.totalFrameTime += duration;
    if (duration < this.minFrameTime) this.minFrameTime = duration;
    if (duration > this.maxFrameTime) this.maxFrameTime = duration;

    // Dirty region stats
    this.dirtyRegionCounts.push(regionCount);
    this.totalDirtyRegions += regionCount;
    if (regionCount < this.minDirtyRegions) this.minDirtyRegions = regionCount;
    if (regionCount > this.maxDirtyRegions) this.maxDirtyRegions = regionCount;
  }

  /**
   * Generates a formatted string of the current performance statistics.
   * @returns {string|null} A report string or null if no data is available.
   */
  getReport() {
    const frameCount = this.frameTimes.length;
    if (frameCount === 0) {
      return '[CapturePerformance] No frames captured in the last period.';
    }

    const avgFrameTime = this.totalFrameTime / frameCount;
    const avgDirtyRegions = this.totalDirtyRegions / frameCount;

    const frameReport = `Frames: ${frameCount} | Avg Time: ${avgFrameTime.toFixed(2)}ms | Min: ${this.minFrameTime.toFixed(2)}ms | Max: ${this.maxFrameTime.toFixed(2)}ms`;
    const regionReport = `Dirty Regions: Avg: ${avgDirtyRegions.toFixed(1)} | Min: ${this.minDirtyRegions} | Max: ${this.maxDirtyRegions}`;

    return `[CapturePerformance] ${frameReport} | ${regionReport}`;
  }
}
