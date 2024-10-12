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
import GlobalStyles from './galobalStyles.js';

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
  <ThemeProvider theme={theme}>
    <GlobalStyles />
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Healing />} />
            <Route path="healing" element={<Healing />} />
          </Route>
        </Routes>
      </Router>
    </Provider>
  </ThemeProvider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
