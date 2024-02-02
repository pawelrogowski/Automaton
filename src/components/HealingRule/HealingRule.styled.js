import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

const StyledDiv = styled.div`
  padding: 0px 4px;
  padding-top: 7px;
  margin-bottom: -1px;
  /* background: #1a1d21; */
  background-image: url(${tibiaBg});
  background-repeat: repeat;
  position: relative;
  border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 3px solid #2c2c2c;
  border-right: 3px solid #2c2c2c;
  display: flex;
  flex-direction: column;
  gap: 2px;

  summary {
    cursor: pointer;
    display: flex;

    align-items: center;
  }
  .input-wrapper {
    position: relative;
  }
  .input-wrapper-checkbox {
    position: relative;
    height: 32px;
    margin-top: 4px;
  }
  .input {
    width: 100px;
    height: 32px;
    padding: 0 12px;
    background: #2b2b2b;
    font-size: 10px;
    border: none;
    color: #d3d3d3;
    outline: none;
    position: relative;
    border-top: 1px solid #757676;
    border-left: 1px solid #757676;
    border-bottom: 1px solid #2c2c2c;
    border-right: 1px solid #2c2c2c;
    &:disabled {
      background: #404040;
    }
  }
  .input-checkbox {
    width: 32px;
    background: #2b2b2b;
  }
  .input-hotkey {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    width: 60px;
  }
  .input-category {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    width: 90px;
  }
  .input-priority {
    width: 55px;
    background: #2b2b2b;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }
  .input-delay {
    width: 85px;
    background: #2b2b2b;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }
  .label {
    position: absolute;
    top: -10px;
    left: 0px;
    font-size: 10px;
    line-height: 10px;
    background: #363636;
    padding: 2px 4px;
    color: #7c8085;
    text-align: center;
    border-top: 1px solid #757676;
    border-left: 1px solid #757676;
    border-right: 1px solid #2c2c2c;
    width: 100%;
    background-image: url(${tibiaBgDark});
    background-repeat: repeat;
  }
  .rule-button {
    display: flex;
    justify-content: center;
    align-items: center;
    border: none;
    background: none;
    border-top: 1px solid #757676;
    border-left: 1px solid #757676;
    border-bottom: 1px solid #2c2c2c;
    border-right: 1px solid #2c2c2c;
  }
  .details-arrow {
    transition: stroke 200ms;
    stroke: #fafafa;
    &:hover {
      stroke: #0066ff;
    }
  }
  .details-wrapper {
    padding-top: 10px;
  }
  .pick-pixel-button {
    padding: 0;

    svg {
      stroke: #fafafa;
      transition: stroke 200ms;
    }
    svg:hover {
      stroke: #0066ff;
    }
  }
  .conditions-header {
    color: #fafafa;
    font-size: 14px;
    padding: 4px;
  }
  .picked-color-wrapper {
    display: flex;
    gap: 8px;
    align-items: center;
    &:not(:last-of-type) {
      padding-bottom: 5px;
      border-bottom: 1px solid #44444b;
    }
    &:not(:first-of-type) {
      padding-top: 5px;
    }
  }
  .remove-color-icon,
  .remove-rule-icon {
    transition: stroke 200ms;
    stroke: #fafafa;

    &:hover {
      cursor: pointer;
      stroke: #bf2828;
    }
  }
  .remove-rule-button {
    margin-left: auto;
  }
  .remove-color {
    margin-left: auto;
  }
  .conditions-header-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    svg {
      margin-bottom: 4px;
    }
  }
  .coordinate-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    list-style: none;
    padding: 0;
    min-width: 45px;
    > li {
      font-size: 9px;
      color: #fafafa;
    }
  }

  .input-percent {
    width: 52px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    text-align: center;
    padding: 0;
    padding-right: 4px;
    border-left: none;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }
  .input-percent-select {
    padding: 0;
    width: 42px;
    appearance: none;
    text-align: center;
    -webkit-appearance: none;
    -moz-appearance: none;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
`;

export default StyledDiv;
