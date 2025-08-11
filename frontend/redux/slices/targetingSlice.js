import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  enabled: false,
  entities: [],
};

const targetingSlice = createSlice({
  name: 'targeting',
  initialState,
  reducers: {
    setenabled: (state, action) => {
      state.enabled = action.payload;
    },
    setEntities: (state, action) => {
      state.entities = action.payload;
    },
  },
});

export const { setenabled, setEntities } = targetingSlice.actions;

export default targetingSlice;
