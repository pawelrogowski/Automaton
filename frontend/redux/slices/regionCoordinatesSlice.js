import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  regions: {
    // This object will be populated by the regionMonitor worker.
    // Example structure after being populated (hierarchical):
    // hotkeyBar: {
    //   x: 100, y: 200, width: 300, height: 50,
    //   children: {
    //     actionBarSlot1: { x: 110, y: 210, width: 32, height: 32 },
    //     actionBarSlot2: { x: 150, y: 210, width: 32, height: 32 }
    //   }
    // },
    // healthBar: { x: 1699, y: 312, width: 94, height: 14 },
    // ... etc.
  },
};

const regionCoordinatesSlice = createSlice({
  name: 'regionCoordinates',
  initialState,
  reducers: {
    /**
     * Replaces the entire set of regions with a new regions object.
     * THIS IS THE PREFERRED METHOD for the regionMonitor worker.
     * It performs an atomic update, ensuring consumers get a consistent state.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - The new object containing all found regions.
     */
    setAllRegions: (state, action) => {
      // Directly replaces the regions object with the complete payload from the worker.
      // This is much more efficient and safer than updating one by one.
      state.regions = action.payload;
    },

    /**
     * Sets the coordinates and dimensions for a single, specific region.
     * Note: This is inefficient for batch updates and can cause race conditions.
     * Use `setAllRegions` for updates from the regionMonitor.
     * @param {object} state - The current state.
     * @param {object} action - The action object containing region details.
     */
    setRegion: (state, action) => {
      const { name, x, y, width, height } = action.payload;
      if (name) {
        state.regions[name] = { x, y, width, height, pixelCount: width * height };
      }
    },

    /**
     * Updates specific properties of an existing region.
     * Useful for targeted, manual updates, perhaps from the UI.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     */
    updateRegion: (state, action) => {
      const { name, updates } = action.payload;
      if (name && state.regions[name]) {
        Object.assign(state.regions[name], updates);
        // Recalculate pixelCount if width or height are updated
        if (updates.width !== undefined || updates.height !== undefined) {
          state.regions[name].pixelCount = state.regions[name].width * state.regions[name].height;
        }
      }
    },

    /**
     * Removes a region from the state.
     * @param {object} state - The current state.
     * @param {string} action.payload - The name of the region to remove.
     */
    removeRegion: (state, action) => {
      const nameToRemove = action.payload;
      if (state.regions[nameToRemove]) {
        delete state.regions[nameToRemove];
      }
    },

    /**
     * Resets the entire regionCoordinates state to its initial empty state.
     */
    resetRegions: (state) => {
      state.regions = initialState.regions;
    },

    /**
     * Replaces the entire slice state. Use with caution.
     * @param {object} state - The current state.
     * @param {object} action - The action containing the new state.
     */
    setState: (state, action) => {
      return action.payload;
    },
  },
});

export const { setAllRegions, setRegion, updateRegion, removeRegion, resetRegions, setState } = regionCoordinatesSlice.actions;

export default regionCoordinatesSlice;
