import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
};

const targetingSlice = createSlice({
  name: 'targeting',
  initialState,
  reducers: {
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
  },
});

export const { setenabled } = targetingSlice.actions;

export default targetingSlice;
