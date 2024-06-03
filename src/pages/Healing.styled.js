import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';

const StyledMain = styled.main`
  display: flex;
  flex-direction: column;
  padding: 2px 2px;
  border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 3px solid #2c2c2c;
  border-right: 3px solid #2c2c2c;
  background-image: url(${tibiaBg});
  background-repeat: repeat;
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100vh;

  .button-container {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 0 2px;
  }
  .header-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
    h2 {
      font-size: 26px;
    }
  }
  .mana-sync-column {
    display: flex;
    flex-direction: row;
    gap: 4px;
    margin-top: 2px;
    width: 100%;
    input,
    select {
      max-width: 46px;
    }
  }
  .enable-wrapper {
    font-size: 8px;
    color: rgb(175, 175, 175);
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .enable-text {
    font-size: 11px;
    color: rgb(175, 175, 175);
  }
  .button-page {
    border: none;
    background: none;
    height: 21px;
    text-align: center;
    display: flex;
    padding: 2px 4px;
    align-items: center;
    color: #757676;
    border-top: 2px solid #757676;
    border-left: 2px solid #757676;
    border-bottom: 2px solid #2c2c2c;
    border-right: 2px solid #2c2c2c;
    color: rgb(175, 175, 175);
    background-image: url(${tibiaBg});
    background-repeat: repeat;
    font-size: 12px;
    margin-top: 2px;
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
    color: rgb(175, 175, 175);
  }
  .main-switch {
  }

  .mana-sync-row {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-top: 2px;
  }
  .mana-sync-hotkey {
    margin-left: auto;
  }
  .mana-sync-row-text {
    font-size: 10px;
    color: rgb(175, 175, 175);
  }
  .refresh-rate-row {
    font-size: 8px;
    color: rgb(175, 175, 175);
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .mana-sync-checkbox-text {
    font-size: 12px;
    color: rgb(175, 175, 175);
  }
  h5 {
    margin: 0;
    color: rgb(175, 175, 175);
    font-size: 11px;
  }
  .list-wrapper {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-wrapper {
    display: flex;
    flex-direction: row;
    gap: 2px;
    padding: 4px;
  }
  .input-field {
    width: 56px;
    height: 24px;
    background-color: #363636;
    border-top: 1px solid #2c2c2c;
    border-left: 1px solid #2c2c2c;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #2b2b2b;
    * {
      font-size: 12px;
      color: rgb(175, 175, 175);
    }
  }
  .input-long {
    width: 64px;
    font-size: 11px;
    height: 16px;
    color: #fafafa;
  }
  .settings-row {
    display: flex;
    flex-direction: row;
    margin-top: 2px;
    > div:not(:first-child) {
      padding-left: 5px;
      border-left: 1px solid rgba(175, 175, 175, 0.9);
    }
    > div:not(:last-child) {
      padding-right: 5px;
      border-right: 1px, rgba(0, 0, 0, 0.7);
    }
  }
  .margin-left {
    margin-left: auto;
  }
  .setting-section {
    min-height: 72px;
    max-height: 72px;
    overflow: hidden;
    gap: 0px;
    * {
      font-size: 11px !important;
      white-space: nowrap;
      line-height: 0.9;
      input,
      select {
        max-height: 18px;
      }
    }
  }
  .top-bar {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }
  .square {
    aspect-ratio: 1;
    width: 40px;
    background: black;
  }
`;
export default StyledMain;
