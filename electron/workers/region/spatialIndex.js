import * as config from './config.js';

/**
 * Spatial grid index for efficient region-rectangle intersection tests
 */
export class SpatialGrid {
  constructor(width, height, cellSize = config.SPATIAL_GRID_SIZE) {
    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error(`Invalid dimensions for SpatialGrid: ${width}x${height}`);
    }

    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.grid = new Map(); // Map<string, Set<string>> - cellKey -> Set of region IDs
  }

  /**
   * Convert coordinates to cell key
   */
  getCellKey(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') {
      return '0,0';
    }
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return `${col},${row}`;
  }

  /**
   * Get all cells that a rectangle intersects
   */
  getIntersectingCells(rect) {
    if (!rect || typeof rect !== 'object') {
      return new Set();
    }

    const { x = 0, y = 0, width = 0, height = 0 } = rect;

    if (width <= 0 || height <= 0) {
      return new Set();
    }

    const cells = new Set();
    const startCol = Math.floor(x / this.cellSize);
    const endCol = Math.floor((x + width - 1) / this.cellSize);
    const startRow = Math.floor(y / this.cellSize);
    const endRow = Math.floor((y + height - 1) / this.cellSize);

    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        cells.add(`${col},${row}`);
      }
    }

    return cells;
  }

  /**
   * Add a region to the spatial index
   */
  addRegion(regionId, region) {
    if (!regionId || !region || typeof region !== 'object') {
      return;
    }

    const cells = this.getIntersectingCells(region);
    for (const cellKey of cells) {
      if (!this.grid.has(cellKey)) {
        this.grid.set(cellKey, new Set());
      }
      this.grid.get(cellKey).add(regionId);
    }
  }

  /**
   * Remove a region from the spatial index
   */
  removeRegion(regionId, region) {
    if (!regionId || !region || typeof region !== 'object') {
      return;
    }

    const cells = this.getIntersectingCells(region);
    for (const cellKey of cells) {
      const cellRegions = this.grid.get(cellKey);
      if (cellRegions) {
        cellRegions.delete(regionId);
        if (cellRegions.size === 0) {
          this.grid.delete(cellKey);
        }
      }
    }
  }

  /**
   * Find all regions that intersect with a rectangle
   */
  findIntersectingRegions(rect) {
    if (!rect || typeof rect !== 'object') {
      return [];
    }

    const regionIds = new Set();
    const cells = this.getIntersectingCells(rect);

    for (const cellKey of cells) {
      const cellRegions = this.grid.get(cellKey);
      if (cellRegions) {
        for (const regionId of cellRegions) {
          regionIds.add(regionId);
        }
      }
    }

    return Array.from(regionIds);
  }

  /**
   * Clear all regions from the index
   */
  clear() {
    this.grid.clear();
  }
}
