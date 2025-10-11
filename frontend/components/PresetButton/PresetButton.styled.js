import styled from 'styled-components';
export const StyledButton = styled.button`
  height: 32px;
  width: 32px;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${(props) => (props.active ? '#fafafa' : '#757676')};
  background: ${(props) =>
    props.active ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 11px;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.1);
  }
`;
