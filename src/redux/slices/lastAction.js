import { createSlice } from '@reduxjs/toolkit';

const lastActionSlice = createSlice({
  name: 'lastAction',
  initialState: null,
  reducers: {
    setLastAction: (_, action) => action.payload,
  },
});

export const { setLastAction } = lastActionSlice.actions;

export default lastActionSlice; 
