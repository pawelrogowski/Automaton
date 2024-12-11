import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';

const StyledMain = styled.main`
  display: flex;
  flex-direction: column;
  background-image: url(${tibiaBg});
  background-repeat: repeat;
  display: flex;
  flex-direction: column;

  display: flex;
  flex-direction: column;
  .healing-enable-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
    top: -1px;
    left: 1px;
    position: absolute;
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
    width: 100%;
    input,
    select {
    }
  }
  .enable-wrapper {
    font-size: 8px;
    color: rgb(175, 175, 175);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .enable-text {
    font-size: 11px;
    color: rgb(175, 175, 175);
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
    border-right: 1px solid #16181d;
    * {
      font-size: 12px;
      color: rgb(175, 175, 175);
    }
  }
  .input-long {
    width: 64px;
    font-size: 11px;
    height: 16px;
    color: #909090;
  }
  .settings-row {
    display: flex;
    flex-direction: row;
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
        width: 48px;
      }
    }
  }
  .top-bar {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    padding: 0 4px;
    gap: 4px;
  }
  .square {
    aspect-ratio: 1;
    width: 40px;
    background: black;
  }
  .input-percent,
  #manaSyncPercentage {
    width: 48px;
  }
  .settings-wrapper {
    padding: 0 4px 6px 4px;
    margin: 6px 0;
  }
  .list-bg {
    details,
    select,
    input,
    summary {
      filter: brightness(1.05);
    }
    summary,
    details {
      background: #414141;
      ul {
        background: #414141;
      }
    }
  }

  .healing-rules-box {
    height: 445px;
    min-height: 445px;
    max-height: 445px;
  }
`;
export default StyledMain;
