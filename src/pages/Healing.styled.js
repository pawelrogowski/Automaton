import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';

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
  .button-container {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 24px;
  }
  .button-page {
    border: none;
    background: none;
    height: 24px;
    margin-bottom: 16px;
    text-align: center;
    display: flex;
    padding: 4px 8px;
    padding-bottom: 6px;
    align-items: center;
    color: #757676;
    font-size: 14px;
    border-top: 2px solid #757676;
    border-left: 2px solid #757676;
    border-bottom: 2px solid #2c2c2c;
    border-right: 2px solid #2c2c2c;

    background-image: url(${tibiaBg});
    background-repeat: repeat;
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
  .add-button {
  }
  .save-button {
    margin-left: auto;
  }
  .save-button,
  .load-button {
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
