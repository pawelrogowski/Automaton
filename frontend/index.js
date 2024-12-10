import React from 'react';
import ReactDOM from 'react-dom/client';
import 'modern-normalize/modern-normalize.css';
import './index.css';

import { Provider } from 'react-redux';

import store from './redux/store.js';
import { BrowserRouter as Router } from 'react-router-dom';
import Layout from './pages/Layout.js';

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
    <Router>
      <Layout />
    </Router>
  </Provider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
