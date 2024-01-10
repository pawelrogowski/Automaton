import React from 'react';
import ReactDOM from 'react-dom/client';
import 'modern-normalize/modern-normalize.css';
import './index.css';
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { Healing } from './pages/Healing.js';
import { Actions } from './pages/Actions.js';
import { Console } from './pages/Console.js';
import Layout from './layouts/Layout.js';

import store from './redux/store.js';

const { ipcRenderer } = window.electron;

ipcRenderer.on('state-change', (_, action) => {
  store.dispatch(action);
});

const theme = {
  colors: {
    primary: '#000',
  },
};

const App = () => (
  <ThemeProvider theme={theme}>
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Healing />} />
            <Route path="healing" element={<Healing />} />
            <Route path="actions" element={<Actions />} />
            <Route path="console" element={<Console />} />
          </Route>
        </Routes>
      </Router>
    </Provider>
  </ThemeProvider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
