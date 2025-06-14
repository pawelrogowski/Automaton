import styled from 'styled-components';

export const StyledList = styled.ul`
  display: flex;
  flex-direction: row;
  gap: 3px;
  align-items: center;
  justify-content: center;
`;

export const StyledListItem = styled.li`
  position: relative;
  list-style: none;
  display: flex;
  align-items: center;
  width: 22px;
  justify-content: center;
  padding: 1px;
  border-radius: 2px;
  border: ${({ checked }) => {
    switch (checked) {
      case true:
        return '2px solid green';
      case false:
        return '2px solid red';
      default:
        return '2px solid transparent';
    }
  }};
`;

export const StyledImageContainer = styled.span`
  display: inline-block;
  position: relative;
`;

export const StyledImage = styled.img`
  width: 18px;
  height: auto;
  cursor: pointer;
`;

export const StyledCheckboxImage = styled.img`
  width: 18px;
  height: auto;
  cursor: pointer;
`;
