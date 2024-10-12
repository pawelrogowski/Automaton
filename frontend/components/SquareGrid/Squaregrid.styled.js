import styled from 'styled-components';

export const StyledDiv = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ squareSize }) => `${squareSize}px`};
  aspect-ratio: 1;
  width: 100px;
`;

export const Square = styled.div`
  width: ${({ squareSize }) => `${squareSize}px`};
  height: ${({ squareSize }) => `${squareSize}px`};
  border-top: 1px solid #757676;
  border-left: 1px solid #757676;
  border-bottom: 1px solid #2c2c2c;
  border-right: 1px solid #2c2c2c;
  transition: border 100ms;
  &:active {
    border-top: 1px solid #2c2c2c;
    border-left: 1px solid #2c2c2c;
    border-bottom: 1px solid #757676;
    border-right: 1px solid #757676;
  }
`;
