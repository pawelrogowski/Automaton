import React from 'react';
import { StyledAside } from './SidebarWrapper.styled.js';

const SidebarWrapper = ({ children, className }) => {
  return <StyledAside className={className}>{children}</StyledAside>;
};

export default SidebarWrapper;
