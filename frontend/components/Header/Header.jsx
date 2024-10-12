import React from 'react';
import MainNavigation from '../MainNavigation/MainNavigation.jsx';
import StyledHeader from './Header.styled.js';

const Header = () => {
  return (
    <StyledHeader>
      <MainNavigation />
    </StyledHeader>
  );
};

export default Header;
