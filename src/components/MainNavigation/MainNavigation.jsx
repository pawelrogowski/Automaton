import React from 'react';
import { Link } from 'react-router-dom';

const MainNavigation = () => {
  return (
    <nav>
      <ul>
        <li>
          <Link to="/healing">Healing</Link>
        </li>
        <li>
          <Link to="/actions">Actions</Link>
        </li>
        <li>
          <Link to="/console">Console</Link>
        </li>
      </ul>
    </nav>
  );
};

export default MainNavigation;
