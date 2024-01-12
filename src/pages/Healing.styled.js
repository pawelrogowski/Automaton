import styled from 'styled-components';

const StyledMain = styled.main`
  section {
    padding: 54px 12px;
    margin: 0 12px;
  }
  .bar-container {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin-bottom: 20px;
  }
  .add-button {
    background: none;
    border: none;
    min-width: 164px;
    height: 42px;
    margin-bottom: 20px;
    display: flex;
    padding: 6px 14px;
    align-items: center;
    border-radius: 12px;
    color: #fafafa;
    font-size: 18px;
    gap: 16px;
    transition:
      scale 100ms,
      color 100ms;
    box-shadow:
      rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
      rgb(1 1 4 / 44%) 0px 4px 6px -1px,
      rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
    s &:active {
      scale: 0.98;
    }
    &:hover {
      cursor: pointer;
      color: #0066ff;
      > svg {
        stroke: #0066ff;
      }
    }
    > svg {
      stroke: #fafafa;
      transition: stroke 200ms;
    }
  }
  .heading-wrapper {
    display: flex;
    gap: 20px;
    align-items: center;
    font-size: 24px;
    margin-bottom: 30px;
  }
  .heading {
    color: #fafafa;
  }
  .main-switch {
    margin-left: auto;
  }

  .health-bar,
  .mana-bar {
    display: flex;
    gap: 12px;
  }

  .hp-icon {
    stroke: none;
    fill: #ff1c1c;
    margin-left: auto;
  }
  .mp-icon {
    stroke: none;
    fill: #0066ff;

    margin-left: auto;
  }
`;

export default StyledMain;
