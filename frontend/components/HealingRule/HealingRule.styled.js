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
  * {
  border-top: none !important;
  }
  summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    list-style: none; /* Ensure list style is none */
    background: #414141;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #555;
    border-bottom: none; /* Prevent double border when details is closed */
    border-bottom: 1px solid #2c2c2c;
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
    font-size: 11px;
    line-height: 1;
    border: none;
    color: #d3d3d3;
    background: #414141;
    outline: none;
    position: relative;
    border-top: 1px solid #16181d;
    border-left: 1px solid #79797930;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #16181d;
  }
  .input-checkbox {
    width: 32px;
    background: #16181d;
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
    font-size: 12px;
    width: 22px;
    height: 22px;
  }

  .remove-rule-button {
    font-size: 14px;
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

  .input-percent,
  .input-monster-num {
    font-family: joystix !important;
    width: 48px;

    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    text-align: center;
    padding: 0;
    padding-right: 4px;
    border-left: none;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    font-size: 10px !important;
    line-height: 1;
  }
  .input-percent-select,
  .input-monster-num-condition {
    font-family: joystix !important;
    padding: 0;
    width: 46px;
    appearance: none;
    text-align: center;
    -webkit-appearance: none;
    -moz-appearance: none;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
    font-size: 10px !important;
    line-height: 1;
  }
  .select-with-arrow::after {
    content: ' ▾';
    color: #909090;
    position: absolute;
    right: 10px; /* Adjust as needed */
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none; /* Ensures clicks go through to the select */
  }
  .checkbox-group {
    padding: 0;
    margin: 0;
    height: 32px;
    width: 175px;
    display: flex;
    justify-content: center;
    align-items: center;
    > div {
      display: flex;
      margin: 0;
      padding: 0;
    }
  }

  /* Adjust widths to match DEFAULT headers */
  .input-hotkey {
    width: 60px; /* Matches default .header-item_4 */
  }
  .input-category {
    width: 90px; /* Matches default .header-item_3 */
  }

  /* Health % Inputs: Total width should match default .header-item_5 (94px) */
  .input-percent-select {
     /* Example: 46px (original?) */
     width: 46px;
     /* ... existing styles: border-right: none, etc. */
     border-top-right-radius: 0;
     border-bottom-right-radius: 0;
     border-right: none;
     text-align: center;
     padding: 0 2px;
  }
  .input-percent {
     /* Example: 48px (original?) */
     width: 48px; /* 46 + 48 = 94px */
     /* ... existing styles: border-left: none, etc. */
     border-top-left-radius: 0;
     border-bottom-left-radius: 0;
     border-left: none;
     text-align: center;
     padding: 0 2px;
  }

  /* Mana % / Monster# Inputs: Total width should match default .header-item_6 (94px) */
  .input-mana-percent-select { /* Use specific class if needed, or reuse .input-percent-select */
      width: 23px; /* Example: Split 94px / 4 elements = ~23.5px */
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
      border-right: none;
      text-align: center;
      padding: 0 1px;
  }
   .input-mana-percent { /* Use specific class if needed, or reuse .input-percent */
      width: 24px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left: none;
       text-align: center;
       padding: 0 1px;
  }
 
  .
  /* Apply the classes above to the correct inputs in HealingRule.js if they aren't already specific */

  .input-priority {
    width: 90px; /* Matches default .header-item_7 */
    /* appearance: none; -webkit-appearance: none; -moz-appearance: none; */ /* Remove if not needed */
  }
  .input-delay {
    width: 85px; /* Matches default .header-item_8 */
     /* appearance: none; -webkit-appearance: none; -moz-appearance: none; */ /* Remove if not needed */
  }

  /* Ensure buttons are pushed right */
  .input-delay { /* Target the last input before buttons */
      /* margin-left: auto; */ /* This might be needed if placeholder isn't used/working */
  }

  .rule-button {
    // ... existing styles ...
    height: 22px; /* Keep original height */
    width: 22px; /* Keep original width */
  }
  .button-expand {
    // ... existing styles ...
  }
  .remove-rule-button {
    // ... existing styles ...
    margin-left: auto; /* Push buttons right for default view */
  }


`;

export default StyledDiv;
