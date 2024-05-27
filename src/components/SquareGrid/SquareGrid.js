import React from 'react';
import { StyledDiv, Square } from './Squaregrid.styled.js';

const SquareGrid = ({ squareSize }) => {
  return (
    <StyledDiv squareSize={squareSize}>
      {[...Array(9)].map((_, index) => (
        <Square key={index} squareSize={squareSize} />
      ))}
    </StyledDiv>
  );
};

export default SquareGrid;
