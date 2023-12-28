import React from 'react';
import ReactDOM from 'react-dom/client';
import 'modern-normalize/modern-normalize.css';
import './index.css';
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import { Healing } from './pages/Healing.js';
import { Actions } from './pages/Actions.js';
import { Console } from './pages/Console.js';
import Layout from './layouts/Layout.js';
import { Provider } from 'react-redux';
import store from './redux/store.js';

const App = () => (
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
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
