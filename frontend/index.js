import React from 'react';
import ReactDOM from 'react-dom/client';
import 'modern-normalize/modern-normalize.css';
import './index.css';

import { Provider } from 'react-redux';

import { Healing } from './pages/Healing.js';

import store from './redux/store.js';

const { ipcRenderer } = window.electron;

window.onload = () => {
  window.electron.ipcRenderer.send('renderer-ready');
};

ipcRenderer.on('state-update', (_, update) => {
  if (update.origin === 'backend') {
    store.dispatch(update);
  }
});

const theme = {
  colors: {
    primary: '#000',
  },
};

const App = () => (
  <Provider store={store}>
    <Healing />
  </Provider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
