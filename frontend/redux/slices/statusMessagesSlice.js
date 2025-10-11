import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  version: 0,
  notPossible: null,
  thereIsNoWay: null,
};

const statusMessagesSlice = createSlice({
  name: 'statusMessages',
  initialState,
  reducers: {
    setNotPossibleTimestamp: (state) => {
      state.notPossible = Date.now();
      state.version = (state.version || 0) + 1;
    },
    setThereIsNoWayTimestamp: (state) => {
      state.thereIsNoWay = Date.now();
      state.version = (state.version || 0) + 1;
    },
  },
});

export const { setNotPossibleTimestamp, setThereIsNoWayTimestamp } =
  statusMessagesSlice.actions;

export default statusMessagesSlice;
