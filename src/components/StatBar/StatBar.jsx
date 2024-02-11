import React from 'react';
import StyledDiv from './StatBar.styled.js';

const StatBar = ({ value, fill }) => {
  return (
    <StyledDiv $value={value} $fill={fill}>
      <div>
        <div />
      </div>
      <span>{value ? `${value}%` : '??%'} </span>
    </StyledDiv>
  );
};

export default StatBar;
