import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,
  regions: {
    // This object will store OCR results for different regions.
    // Example:
    // gameLog: "Some text from the game log",
    // skillsWidget: "Text from the skills widget",
  },
};

const ocrSlice = createSlice({
  name: 'ocr',
  initialState,
  reducers: {
    /**
     * Sets the OCR recognized text for a specific region.
     * @param {object} state - The current state.
     * @param {object} action - The action object.
     * @param {object} action.payload - Contains the region name and the recognized text.
     * @param {string} action.payload.regionName - The name of the region (e.g., 'gameLog', 'skillsWidget').
     * @param {string} action.payload.text - The recognized text from the region.
     */
    setOcrRegionsText: (state, action) => {
      // The payload is expected to be an object where keys are region names and values are the recognized text.
      // Example: { gameLog: "text", skillsWidget: "text" }
      const newOcrRegions = action.payload;
      if (newOcrRegions && typeof newOcrRegions === 'object') {
        Object.assign(state.regions, newOcrRegions);
        state.version = (state.version || 0) + 1;
      }
    },
    /**
     * Resets the entire ocr state to its initial empty state.
     */
    resetOcr: (state) => {
      state.regions = initialState.regions;
      state.version = (state.version || 0) + 1;
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

export const { setOcrRegionsText, resetOcr, setState } = ocrSlice.actions;

export default ocrSlice;
