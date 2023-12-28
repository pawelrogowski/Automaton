import styled from 'styled-components';

const StyledMain = styled.main`
  section {
    padding: 32px 12px;
  }
  .add-button {
    background: none;
    border: none;
    width: 42px;
    height: 42px;
    margin-bottom: 20px;

    &:hover {
      cursor: pointer;
      > svg {
        stroke: #0066ff;
      }
    }
    > svg {
      border-radius: 7px;
      box-shadow:
        rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
        rgba(6, 24, 44, 0.65) 0px 4px 6px -1px,
        rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
      stroke: #c5c5c5;
      transition: stroke 200ms;
    }
  }
`;

export default StyledMain;
