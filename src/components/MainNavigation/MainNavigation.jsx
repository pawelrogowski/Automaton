import React from 'react';
import { Link } from 'react-router-dom';
import StyledNav from './MainNavigation.styled.js';

const MainNavigation = () => {
  return (
    <StyledNav>
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
    </StyledNav>
  );
};

export default MainNavigation;
