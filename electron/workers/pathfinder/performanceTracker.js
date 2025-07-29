/**
 * A class to track, calculate, and report performance statistics.
 */
export class PerformanceTracker {
  constructor() {
    this.reset();
  }

  /**
   * Resets all statistics to their initial state.
   */
  reset() {
    this.times = [];
    this.minTime = Infinity;
    this.maxTime = 0;
    this.totalTime = 0;
  }

  /**
   * Adds a new duration measurement to the tracker.
   * @param {number} duration - The time in milliseconds for an operation.
   */
  addMeasurement(duration) {
    this.times.push(duration);
    this.totalTime += duration;
    if (duration < this.minTime) this.minTime = duration;
    if (duration > this.maxTime) this.maxTime = duration;
  }

  /**
   * Calculates the median from the collected times.
   * @returns {number} The median value.
   */
  _calculateMedian() {
    const sorted = [...this.times].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Generates a formatted string of the current performance statistics.
   * @returns {string|null} A report string or null if no data is available.
   */
  getReport() {
    const iterations = this.times.length;
    if (iterations === 0) {
      return '[PathfinderPerformance] No successful pathfinding operations in the last period.';
    }

    const avg = this.totalTime / iterations;
    const median = this._calculateMedian();

    const report = [
      '[PathfinderPerformance] Stats:',
      `${iterations} paths found |`,
      `Avg: ${avg.toFixed(2)}ms |`,
      `Median: ${median.toFixed(2)}ms |`,
      `Min: ${this.minTime.toFixed(2)}ms |`,
      `Max: ${this.maxTime.toFixed(2)}ms`,
    ].join(' ');

    return report;
  }
}
