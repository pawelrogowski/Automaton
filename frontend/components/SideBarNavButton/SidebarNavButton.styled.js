import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
export const StyledLink = styled(NavLink)`
  display: flex;
  align-items: center;
  padding: 0 4px;
  text-decoration: none;
  color: ${({ $isActive }) => ($isActive ? '#fafafa' : '#757676')};
  height: 36px;
  width: 100%;
  position: relative;

  background: ${({ $isActive }) => ($isActive ? '#2b2b2b' : 'transparent')};
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);

  ${({ $isActive }) =>
    $isActive &&
    `
    &::after {
      content: '';
      position: absolute;
      z-index: 999;
      right: 10px; /* Adjust the distance of the triangle from the right edge */
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 8px solid #fafafa; /* Color of the triangle */
    }
  `}

  .image-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 36px;
    height: 36px;
  }

  > span {
    padding: 0 18px;
    text-align: center;
    color: #fafafa;
    font-size: 11px;
  }
`;
