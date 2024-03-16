import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';

const StyledMain = styled.main`
  padding: 12px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  .bar-container {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .button-container {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 24px;
  }
  .header-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
    h2 {
      font-size: 26px;
    }
    .enable-wrapper {
      display: flex;
      flex-direction: row;
      gap: 8px;
      outline: red;
    }
  }
  .button-page {
    border: none;
    background: none;
    height: 28px;
    margin-bottom: 16px;
    text-align: center;
    display: flex;
    padding: 2px 6px;
    padding-bottom: 6px;
    align-items: center;
    color: #757676;
    font-size: 14px;
    border-top: 2px solid #757676;
    border-left: 2px solid #757676;
    border-bottom: 2px solid #2c2c2c;
    border-right: 2px solid #2c2c2c;
    color: rgb(175, 175, 175);
    background-image: url(${tibiaBg});
    background-repeat: repeat;
    &:active {
      border-top: 2px solid #2c2c2c;
      border-left: 2px solid #2c2c2c;
      border-bottom: 2px solid #757676;
      border-right: 2px solid #757676;
    }

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
  .add-button {
    background: #008d0c4f;
    border-top: 2px solid #486554;
    border-left: 2px solid #486554;
    border-bottom: 2px solid #143518;
    border-right: 2px solid #143518;
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
  }

  .health-bar,
  .mana-bar {
    display: flex;
    gap: 12px;

    > svg {
      margin-left: auto;
      width: 22px;
      height: 22px;
    }
  }

  .hp-icon {
    stroke: none;
    fill: #ff1c1c;
    margin-left: auto;
    filter: drop-shadow(0px 1px 1px #000000);
    rotate: 4deg;
  }
  .mp-icon {
    stroke: none;
    fill: #0066ff;
    filter: drop-shadow(0px 1px 1px #000000);
    rotate: 18deg;
    margin-left: auto;
  }
`;

export default StyledMain;
