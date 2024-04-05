import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';
const StyledDiv = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  &:hover {
    z-index: 500;
    outline: 2px solid rgba(255, 255, 255, 0.6) !important;
  }
  summary {
    cursor: pointer;
    display: flex;
    height: 22px;
    align-items: center;
  }
  .input-wrapper {
    position: relative;
    height: 100%;
    padding: 0;
    margin: 0;
    position: relative;
  }
  .input-wrapper-checkbox {
    position: relative;
    height: 22px;
    margin-top: 4px;
  }
  input,
  select {
    width: 100px;
    height: 22px;
    padding: 0 6px;
    font-size: 10px;
    border: none;
    color: #d3d3d3;
    background: #414141;
    outline: none;
    position: relative;
    border-top: 1px solid #2b2b2b;
    border-left: 1px solid #79797930;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #2b2b2b;
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
    width: 90px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }
  .input-delay {
    width: 85px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }
  .rule-button {
    font-size: 12px;
    height: 22px;
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
    /* margin-bottom: 8px; */

    cursor: pointer;
    &:active {
      border-top: 1px solid #2c2c2c;
      border-left: 1px solid #2c2c2c;
      border-bottom: 1px solid #757676;
      border-right: 1px solid #757676;
    }
  }
  .button-expand {
    font-size: 13px;
    width: 22px;
    height: 22px;
  }

  .remove-rule-button {
    font-size: 20px;
    margin-left: auto;
    justify-self: flex-end;
    width: 22px;
    height: 22px;
    background: #8f000052;
    border-top: 1px solid #8b5757;
    border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909;
    border-right: 1px solid #470909;
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
    border-right: none;
  }
  .select-with-arrow::after {
    content: ' ▾';
    color: #fafafa;
    position: absolute;
    right: 10px; /* Adjust as needed */
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none; /* Ensures clicks go through to the select */
  }
`;

export default StyledDiv;
