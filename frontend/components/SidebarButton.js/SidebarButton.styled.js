import styled from 'styled-components';

export const StyledButton = styled.button`
  display: flex;
  align-items: center;
  padding: 0px 5px;
  height: 29px;
  text-decoration: none;
  font-size: 12px;
  text-align: center;
  justify-content: center;
  color: #fafafa;
  border-radius: 4px;
  border: 1px solid rgb(53, 53, 53);
  background-color: rgb(26, 26, 26);
  &:hover {
    border: 1px solid rgb(80, 80, 80);
    background-color: rgb(53, 53, 53);
  }
  img {
    width: 12px;
    height: 12px;
    margin-right: 8px;
  }
`;
