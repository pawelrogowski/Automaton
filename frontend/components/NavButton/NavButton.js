import React from 'react';
import { StyledLink } from './NavButton.styled.js';

const NavButton = ({ to, img, text, imageWidth }) => {
  return (
    <StyledLink to={to} end>
      {img && <img src={img} alt={text} width={imageWidth} />}
      <span>{text}</span>
    </StyledLink>
  );
};

export default NavButton;
