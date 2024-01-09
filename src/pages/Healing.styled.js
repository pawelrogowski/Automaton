import styled from 'styled-components';

const StyledMain = styled.main`
  section {
    padding: 54px 12px;
    margin: 0 12px;
  }
  .bar-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 20px;
  }
  .add-button {
    background: none;
    border: none;
    width: 42px;
    height: 42px;
    margin-bottom: 20px;
    position: fixed;
    top: 5px;
    right: 12px;
    z-index: 6;

    &:hover {
      cursor: pointer;
      > svg {
        stroke: #0066ff;
      }
    }
    > svg {
      stroke: #fafafa;
      transition: stroke 200ms;
    }
  }
`;

export default StyledMain;
