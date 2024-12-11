import React from 'react';
import MainNavigation from '../MainNavigation/MainNavigation.jsx';
import StyledHeader from './Header.styled.js';

const Header = ({ children }) => {
  return <StyledHeader>{children}</StyledHeader>;
};

export default Header;
