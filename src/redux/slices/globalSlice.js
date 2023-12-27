import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  windowTitle: '',
};

const globalSlice = createSlice({
  name: 'global',
  initialState,
  reducers: {
    setWindowTitle: (state, action) => {
      state.windowTitle = action.payload;
    },
  },
});

export const { setWindowTitle } = globalSlice.actions;

export default globalSlice;
