import * as config from './config.js';

/**
 * Tracks confidence levels for regions and manages their lifecycle
 */
export class ConfidenceTracker {
  constructor() {
    this.regions = new Map(); // Map<string, RegionConfidence>
    this.lastUpdate = Date.now();
  }

  /**
   * Region confidence data structure
   */
  createRegionConfidence(name, initialConfidence = config.CONFIDENCE_NONE) {
    return {
      name,
      confidence: initialConfidence,
      lastFound: 0,
      lastVerified: 0,
      scanCount: 0,
      foundCount: 0,
      position: null, // Last known position {x, y, width, height}
      type: null, // Region type
    };
  }

  /**
   * Add or update a region's confidence
   */
  updateRegion(name, confidence, position = null, type = null) {
    if (!name || typeof name !== 'string') {
      console.warn('[ConfidenceTracker] Invalid region name:', name);
      return null;
    }

    let region = this.regions.get(name);
    if (!region) {
      region = this.createRegionConfidence(name, confidence);
      this.regions.set(name, region);
    }

    // Ensure confidence is within bounds
    region.confidence = Math.min(
      config.CONFIDENCE_HIGH,
      Math.max(config.CONFIDENCE_NONE, confidence),
    );

    if (position && typeof position === 'object') {
      region.position = position;
    }

    if (type && typeof type === 'string') {
      region.type = type;
    }

    const now = Date.now();
    if (confidence > config.CONFIDENCE_NONE) {
      region.lastFound = now;
      region.foundCount++;
    }
    region.lastVerified = now;
    region.scanCount++;

    return region;
  }

  /**
   * Get region confidence data
   */
  getRegion(name) {
    return this.regions.get(name);
  }

  /**
   * Get all regions
   */
  getAllRegions() {
    return Array.from(this.regions.values());
  }

  /**
   * Get regions by confidence level
   */
  getRegionsByConfidence(
    minConfidence,
    maxConfidence = config.CONFIDENCE_HIGH,
  ) {
    return this.getAllRegions().filter(
      (region) =>
        region.confidence >= minConfidence &&
        region.confidence <= maxConfidence,
    );
  }

  /**
   * Apply confidence decay based on time elapsed
   */
  applyDecay() {
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000; // Convert to seconds

    for (const region of this.regions.values()) {
      if (region.confidence <= config.CONFIDENCE_NONE) continue;

      let decayRate;
      if (region.confidence >= config.CONFIDENCE_HIGH) {
        decayRate = config.CONFIDENCE_DECAY_HIGH;
      } else if (region.confidence >= config.CONFIDENCE_MEDIUM) {
        decayRate = config.CONFIDENCE_DECAY_MEDIUM;
      } else {
        decayRate = config.CONFIDENCE_DECAY_LOW;
      }

      const decay = decayRate * elapsed;
      region.confidence = Math.max(
        config.CONFIDENCE_NONE,
        region.confidence - decay,
      );
    }

    this.lastUpdate = now;
  }

  /**
   * Boost confidence for found regions
   */
  boostFoundRegions(foundRegions) {
    if (!foundRegions || typeof foundRegions !== 'object') return;

    for (const region of foundRegions) {
      if (region && region.name) {
        const confidence = this.getRegion(region.name);
        if (confidence) {
          this.updateRegion(
            region.name,
            confidence.confidence + config.CONFIDENCE_BOOST_FOUND,
            region.position,
            region.type,
          );
        }
      }
    }
  }

  /**
   * Get regions that need verification (haven't been verified recently)
   */
  getRegionsNeedingVerification(maxAge = config.REGION_VERIFY_INTERVAL_MS) {
    const now = Date.now();
    return this.getAllRegions().filter(
      (region) => now - region.lastVerified > maxAge,
    );
  }

  /**
   * Remove regions that no longer exist (confidence = NONE for too long)
   */
  cleanupStaleRegions(maxAge = 10000) {
    const now = Date.now();
    const toRemove = [];

    for (const [name, region] of this.regions) {
      if (
        region.confidence === config.CONFIDENCE_NONE &&
        now - region.lastVerified > maxAge
      ) {
        toRemove.push(name);
      }
    }

    for (const name of toRemove) {
      this.regions.delete(name);
    }

    return toRemove.length;
  }

  /**
   * Get statistics
   */
  getStats() {
    const regions = this.getAllRegions();
    const high = regions.filter(
      (r) => r.confidence >= config.CONFIDENCE_HIGH,
    ).length;
    const medium = regions.filter(
      (r) =>
        r.confidence >= config.CONFIDENCE_MEDIUM &&
        r.confidence < config.CONFIDENCE_HIGH,
    ).length;
    const low = regions.filter(
      (r) =>
        r.confidence > config.CONFIDENCE_NONE &&
        r.confidence < config.CONFIDENCE_MEDIUM,
    ).length;
    const none = regions.filter(
      (r) => r.confidence === config.CONFIDENCE_NONE,
    ).length;

    return {
      total: regions.length,
      high,
      medium,
      low,
      none,
      averageConfidence:
        regions.length > 0
          ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
          : 0,
    };
  }
}
