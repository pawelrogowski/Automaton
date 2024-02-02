import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

export const StyledList = styled.ul`
  display: flex;
  flex-direction: row;
  gap: 3px;
  align-items: center;
  padding: 1px 1px;
  border-top: 1px solid #2c2c2c;
  border-left: 1px solid #2c2c2c;
  border-bottom: 1px solid #757676;
  border-right: 1px solid #757676;
  background-image: url(${tibiaBgDark});
  background-repeat: repeat;
  z-index: 10;
`;

export const StyledListItem = styled.li`
  position: relative;
  list-style: none;
`;

export const StyledImageContainer = styled.span`
  display: inline-block;
  position: relative;
`;

export const StyledImage = styled.img`
  width: 11px;
  height: auto;
  cursor: pointer;
  &.green-border {
    border-bottom: 2px solid green;
  }
  &.red-border {
    border-bottom: 2px solid red;
  }
`;

export const StyledCheckboxImage = styled.img`
  width: 11px;
  height: auto;
  cursor: pointer;
  &.checked {
    border-bottom: 2px solid green;
  }
  &.unchecked {
    border-bottom: 2px solid red;
  }
`;
