// PresetButton.styled.js
import styled from 'styled-components';

export const StyledButton = styled.button`
  border: none;
  background: none;
  height: 21px;
  text-align: center;
  display: flex;
  align-items: center;
  color: ${(props) => (props.active ? '#fafafa' : '#757676')};
  border-top: 2px solid ${(props) => (props.active ? '#2c2c2c' : '#757676')};
  border-left: 2px solid ${(props) => (props.active ? '#2c2c2c' : '#757676')};
  border-bottom: 2px solid ${(props) => (props.active ? '#757676' : '#2c2c2c')};
  border-right: 2px solid ${(props) => (props.active ? '#757676' : '#2c2c2c')};
  font-size: 12px;

  &:hover {
    cursor: pointer;
  }
`;
