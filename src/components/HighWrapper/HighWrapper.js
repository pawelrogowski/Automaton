import React from 'react';
import { StyledDiv } from './HighWrapper.styled.js';

const HighWrapper = ({ children, title, className }) => {
  return (
    <StyledDiv>
      {title && <h2 className="title">{title}</h2>}
      <div className={className}>{children}</div>
    </StyledDiv>
  );
};

export default HighWrapper;
