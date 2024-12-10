import { NavLink } from 'react-router-dom';
import styled from 'styled-components';

export const StyledLink = styled(NavLink)`
  display: flex;
  align-items: center;
  padding: 8px 12px;
  text-decoration: none;
  color: inherit;
  border-top: 1px solid rgba(117, 117, 118, 0.8);
  border-left: 1px solid rgba(117, 117, 118, 0.8);
  border-bottom: 1px solid rgba(44, 44, 44, 0.8);
  border-right: 1px solid rgba(44, 44, 44, 0.8);

  &:active {
    border-top: 1px solid rgba(44, 44, 44, 0.8);
    border-left: 1px solid rgba(44, 44, 44, 0.8);
    border-bottom: 1px solid rgba(117, 117, 118, 0.8);
    border-right: 1px solid rgba(117, 117, 118, 0.8);
  }
  &.active {
    border-top: 1px solid rgba(44, 44, 44, 0.8);
    border-left: 1px solid rgba(44, 44, 44, 0.8);
    border-bottom: 1px solid rgba(117, 117, 118, 0.8);
    border-right: 1px solid rgba(117, 117, 118, 0.8);
  }
  img {
    width: 20px;
    height: 20px;
    margin-right: 8px;
  }
`;
