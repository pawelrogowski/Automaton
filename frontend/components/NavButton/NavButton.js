import React from 'react';
import { StyledLink } from './NavButton.styled.js';

const NavButton = ({ to, img, text }) => {
  return (
    <StyledLink to={to} end>
      {img && <img src={img} alt={text} />}
      {text}
    </StyledLink>
  );
};

export default NavButton;
