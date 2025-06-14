import styled from 'styled-components';

export const StyledButton = styled.button`
  display: flex;
  align-items: center;
  padding: 0px 5px;
  height: 22px;
  text-decoration: none;
  font-size: 11px;
  color: #fafafa;
  border-top: 1px solid rgba(117, 117, 118, 0.8);
  border-left: 1px solid rgba(117, 117, 118, 0.8);
  border-bottom: 1px solid rgba(44, 44, 44, 0.8);
  border-right: 1px solid rgba(44, 44, 44, 0.8);
  background: transparent;
  background-repeat: repeat;

  &:active {
    border-top: 1px solid rgba(44, 44, 44, 0.8);
    border-left: 1px solid rgba(44, 44, 44, 0.8);
    border-bottom: 1px solid rgba(117, 117, 118, 0.8);
    border-right: 1px solid rgba(117, 117, 118, 0.8);
    background: transparent;
  }
  &.active {
    border-top: 1px solid rgba(44, 44, 44, 0.8);
    border-left: 1px solid rgba(44, 44, 44, 0.8);
    border-bottom: 1px solid rgba(117, 117, 118, 0.8);
    border-right: 1px solid rgba(117, 117, 118, 0.8);
    background: transparent;
  }
  img {
    width: 12px;
    height: 12px;
    margin-right: 8px;
  }
`;
