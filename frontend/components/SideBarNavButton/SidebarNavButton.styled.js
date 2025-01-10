import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';

export const StyledLink = styled(NavLink)`
  display: flex;
  align-items: center;
  padding: 0 4px;
  text-decoration: none;
  color: inherit;
  height: 36px;
  width: 100%;
  border-top: 1px solid rgba(117, 117, 118, 0.8);
  border-left: 1px solid rgba(117, 117, 118, 0.8);
  border-bottom: 1px solid rgba(44, 44, 44, 0.8);
  border-right: 1px solid rgba(44, 44, 44, 0.8);
  background: url(${tibiaBg});
  background-repeat: repeat;
  position: relative; /* Needed for positioning the ::after pseudo-element */

  ${({ $isActive }) =>
    $isActive &&
    `
    border-top: 1px solid rgba(44, 44, 44, 0.8);
    border-left: 1px solid rgba(44, 44, 44, 0.8);
    border-bottom: 1px solid rgba(117, 117, 118, 0.8);
    border-right: 1px solid rgba(117, 117, 118, 0.8);

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
