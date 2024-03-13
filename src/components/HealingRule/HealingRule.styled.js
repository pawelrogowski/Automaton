import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';
const StyledDiv = styled.div`
  /* padding: 0px 4px;
  padding-top: 7px;
  margin-bottom: -1px; */
  /* background: #1a1d21; */
  background-image: url(${tibiaBg});
  background-repeat: repeat;
  position: relative;
  /* border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 3px solid #2c2c2c;
  border-right: 3px solid #2c2c2c; */
  display: flex;
  flex-direction: column;
  /* gap: 2px; */
  min-width: 810px;
  background: #2b2b2b;
  summary {
    cursor: pointer;
    display: flex;
    height: 18px;
    align-items: center;
  }
  .input-wrapper {
    position: relative;
    height: 100%;
    padding: 0;
    margin: 0;
  }
  .input-wrapper-checkbox {
    position: relative;
    height: 32px;
    margin-top: 4px;
  }
  .input {
    width: 100px;
    height: 18px;
    padding: 0 6px;
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
  .rule-button {
    font-size: 11px;
    height: 18px;
    display: flex;
    justify-content: center;
    align-items: center;
    border: none;
    background: none;
    border-top: 1px solid #757676;
    border-left: 1px solid #757676;
    border-bottom: 1px solid #2c2c2c;
    border-right: 1px solid #2c2c2c;
    color: rgb(175, 175, 175);
    margin-bottom: 8px;

    cursor: pointer;
    &:active {
      border-top: 1px solid #2c2c2c;
      border-left: 1px solid #2c2c2c;
      border-bottom: 1px solid #757676;
      border-right: 1px solid #757676;
    }
  }
  .button-expand {
    margin-left: 6px;
  }
  .details-arrow {
    transition: stroke 200ms;
    stroke: #fafafa;
    &:hover {
      stroke: #0066ff;
    }
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

  .remove-rule-button {
    margin-left: auto;
    background: #8f000052;
    border-top: 1px solid #8b5757;
    border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909;
    border-right: 1px solid #470909;
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
