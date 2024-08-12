import React from 'react';
import { StyledDiv } from './SunkenWrapper.styled.js';

const SunkenWrapper = ({ children, title }) => {
  return (
    <StyledDiv>
      {title && <h2 className="title">{title}</h2>}
      {children}
    </StyledDiv>
  );
};

export default SunkenWrapper;
