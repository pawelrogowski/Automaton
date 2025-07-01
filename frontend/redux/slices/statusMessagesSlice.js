import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  notPossible: null,
  thereIsNoWay: null,
};

const statusMessagesSlice = createSlice({
  name: 'statusMessages',
  initialState,
  reducers: {
    setNotPossibleTimestamp: (state) => {
      state.notPossible = Date.now();
    },
    setThereIsNoWayTimestamp: (state) => {
      state.thereIsNoWay = Date.now();
    },
  },
});

export const { setNotPossibleTimestamp, setThereIsNoWayTimestamp } = statusMessagesSlice.actions;

export default statusMessagesSlice;
