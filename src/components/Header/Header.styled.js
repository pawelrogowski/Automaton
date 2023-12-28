import styled from 'styled-components';

const StyledHeader = styled.header`
  width: 100vw;
  height: 40px;
  margin: 0;
  padding: 0;
  padding-left: 12px;
  box-shadow:
    rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
    rgb(1 1 4 / 44%) 0px 4px 6px -1px,
    rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
  display: flex;
  align-items: center;
  position: fixed;
  top: 0;
  left: 0;
  background: #1a1d21;
  z-index: 5;
`;

export default StyledHeader;
