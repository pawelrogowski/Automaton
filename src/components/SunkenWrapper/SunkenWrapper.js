import React from 'react';
import { StyledDiv } from './SunkenWrapper.styled.js';

const SunkenWrapper = ({ children, className }) => {
  return <StyledDiv className={className}>{children}</StyledDiv>;
};

export default SunkenWrapper;
