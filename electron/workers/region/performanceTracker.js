/**
 * A class to track, calculate, and report region scanning performance.
 */
export class PerformanceTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.scanCount = 0;
    this.totalScanTime = 0;
  }

  /**
   * Adds a new scan measurement to the tracker.
   * @param {number} duration - The time in milliseconds for the scan.
   */
  addScan(duration) {
    this.scanCount++;
    this.totalScanTime += duration;
  }

  getReport() {
    if (this.scanCount === 0) {
      return '[RegionPerformance] No scan operations in the last period.';
    }

    const avgScanTime = (this.totalScanTime / this.scanCount).toFixed(2);
    const report = [
      '[RegionPerformance] Stats:',
      `Avg Time: ${avgScanTime}ms |`,
      `Total Scans: ${this.scanCount}`,
    ].join(' ');

    return report;
  }
}
