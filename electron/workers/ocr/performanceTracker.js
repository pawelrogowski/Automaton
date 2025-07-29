/**
 * A class to track, calculate, and report OCR performance statistics.
 */
export class PerformanceTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.operationTimes = [];
    this.totalOperationTime = 0;
    this.regionsProcessedCounts = [];
    this.totalRegionsProcessed = 0;
  }

  /**
   * Adds a new measurement from a single performOperation cycle.
   * @param {number} duration - The time in milliseconds for the operation.
   * @param {number} regionCount - The number of regions processed in the operation.
   */
  addMeasurement(duration, regionCount) {
    this.operationTimes.push(duration);
    this.totalOperationTime += duration;
    this.regionsProcessedCounts.push(regionCount);
    this.totalRegionsProcessed += regionCount;
  }

  getReport() {
    const operationCount = this.operationTimes.length;
    if (operationCount === 0) {
      return '[OcrPerformance] No OCR operations in the last period.';
    }

    const avgOpTime = this.totalOperationTime / operationCount;
    const maxOpTime = Math.max(...this.operationTimes);
    const avgRegions = this.totalRegionsProcessed / operationCount;

    const report = [
      '[OcrPerformance] Stats:',
      `${operationCount} ops |`,
      `Avg Time: ${avgOpTime.toFixed(2)}ms |`,
      `Max Time: ${maxOpTime.toFixed(2)}ms |`,
      `Avg Regions/Op: ${avgRegions.toFixed(1)}`,
    ].join(' ');

    return report;
  }
}
