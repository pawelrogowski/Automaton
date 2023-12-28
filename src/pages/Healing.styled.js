import styled from 'styled-components';

const StyledMain = styled.main`
  section {
    padding: 8px 12px;
    margin: 0 12px;
  }
  .add-healing-rule {
    position: fixed;
    top: 5px;
    right: 12px;
    z-index: 6;
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
      stroke: #c5c5c5;
      transition: stroke 200ms;
    }
  }
`;

export default StyledMain;
