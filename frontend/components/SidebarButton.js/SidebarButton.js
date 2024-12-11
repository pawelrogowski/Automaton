import React from 'react';
import { StyledButton } from './SidebarButton.styled.js';

const SidebarButton = ({ img, text, onClick }) => {
  return (
    <StyledButton onClick={onClick}>
      {img && <img src={img} alt={text} />}
      {text}
    </StyledButton>
  );
};

export default SidebarButton;
