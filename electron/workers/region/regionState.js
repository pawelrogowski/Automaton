// @electron/workers/region/regionState.js
export class RegionState {
  constructor() {
    this.regions = {};
    this.regionBounds = new Map(); // Cache for fast intersection tests
    this.lastUpdateTime = 0;
    this.regionHistory = new Map(); // Track region changes over time
  }

  /**
   * Get the current region state.
   * @returns {object} Current region state
   */
  get() {
    return this.regions;
  }

  /**
   * Update the region state.
   * @param {object} newRegions - New region state
   */
  update(newRegions) {
    this.regions = newRegions;
    this.updateRegionBounds();
    this.updateRegionHistory();
    this.lastUpdateTime = Date.now();
  }

  /**
   * Update the cached region bounds for fast intersection tests.
   */
  updateRegionBounds() {
    this.regionBounds.clear();
    this.extractRegionBounds(this.regions, '');
  }

  /**
   * Extract region bounds recursively.
   * @param {object} regions - Regions to extract bounds from
   * @param {string} prefix - Prefix for nested regions
   */
  extractRegionBounds(regions, prefix) {
    for (const [name, region] of Object.entries(regions)) {
      if (region && region.x !== undefined && region.width !== undefined) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        this.regionBounds.set(fullName, region);
      }

      if (region && region.children) {
        this.extractRegionBounds(
          region.children,
          prefix ? `${prefix}.${name}` : name,
        );
      }
    }
  }

  /**
   * Update the history of region changes.
   */
  updateRegionHistory() {
    const now = Date.now();

    // Clean old entries (older than 10 seconds)
    for (const [key, entries] of this.regionHistory.entries()) {
      const recentEntries = entries.filter(
        (entry) => now - entry.timestamp < 10000,
      );
      if (recentEntries.length === 0) {
        this.regionHistory.delete(key);
      } else {
        this.regionHistory.set(key, recentEntries);
      }
    }

    // Add current state to history
    for (const [name, region] of Object.entries(this.regions)) {
      if (!this.regionHistory.has(name)) {
        this.regionHistory.set(name, []);
      }

      this.regionHistory.get(name).push({
        timestamp: now,
        region: { ...region },
      });
    }
  }

  /**
   * Get the history of a specific region.
   * @param {string} name - Region name
   * @returns {Array} History of the region
   */
  getRegionHistory(name) {
    return this.regionHistory.get(name) || [];
  }

  /**
   * Get the time of the last update.
   * @returns {number} Timestamp of last update
   */
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
}
