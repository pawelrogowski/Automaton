import React from 'react';
import { StyledDiv } from './HighWrapper.styled.js';

const HighWrapper = ({ children, title, className }) => {
  return (
    <StyledDiv>
      <div className={className}>{children}</div>
    </StyledDiv>
  );
};

export default HighWrapper;
