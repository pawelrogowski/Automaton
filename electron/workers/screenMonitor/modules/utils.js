export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  // Calculate delay needed to approximate the target refresh rate
  export function calculateDelayTime(executionTime, refreshRate) {
    const targetInterval = refreshRate ? (1000 / refreshRate) : 50; // Default to 50ms (20 FPS) if no refreshRate
    return Math.max(0, targetInterval - executionTime); // Ensure delay is not negative
  }
  
  // Create a region object {x, y, width, height} from absolute coordinates
  export function createRegion(markerCoords, width, height) {
    return markerCoords?.x !== undefined ? { x: markerCoords.x, y: markerCoords.y, width, height } : null;
  }
  
  // Validate if a region object has valid dimensions
  export function validateRegionDimensions(region) {
    // Ensure region exists and has defined coordinates plus positive width/height
    return region?.x !== undefined && region?.y !== undefined && region.width > 0 && region.height > 0;
  }
  
  // Add other general utility functions here as needed during refactoring...
  // For example: createRegion could potentially move here if it doesn't depend heavily on module-specific state.