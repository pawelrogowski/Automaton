import React from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import StyledNav from './MainNavigation.styled.js';

const MainNavigation = () => {
  const { windowName } = useSelector((state) => state.global);
  return (
    <StyledNav>
      <ul>
        {/* <li>
          <Link to="/healing">Healing</Link>
        </li> */}
        {/* <li>
          <Link to="/actions">Actions</Link>
        </li>
        <li>
          <Link to="/console">Console</Link>
        </li>
        <li>
          <Link to="/console">Cavebot</Link>
        </li>
        <li>
          <Link to="/console">Market</Link>
        </li> */}
        <li className="character-name">{windowName}</li>
      </ul>
    </StyledNav>
  );
};

export default MainNavigation;
