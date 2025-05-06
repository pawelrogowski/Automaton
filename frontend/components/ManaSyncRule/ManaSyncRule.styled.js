import styled from 'styled-components';

// Use the same height variable as CustomIconSelect for consistency
const ROW_HEIGHT = '38px';
const BUTTON_SIZE = '38px'; // New constant for buttons

// Main styled div for the entire rule row
const StyledDiv = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  &:hover {
    z-index: 500;
    outline: 2px solid rgba(255, 255, 255, 0.6) !important;
  }

  details {
     background-color: #3a3a3a;
    
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

  /* Container for inputs/buttons in the SUMMARY row */
  .rule-content {
    display: flex;
    height: ${ROW_HEIGHT};
    align-items: center;
    width: 100%;
    padding-right: 2px;

     > * {
        flex-shrink: 0;
     }
     /* Target enable checkbox wrapper */
     > div:has(> input[type="checkbox"]):first-child {
         width: 36px;
         height: ${ROW_HEIGHT};
         display: flex;
         align-items: center;
         justify-content: center;
     }
  }

  /* Wrapper for the CustomIconSelect in SUMMARY */
  .action-item-wrapper {
      width: 260px;
      height: ${ROW_HEIGHT};
      > div { width: 100%; height: 100%; }
  }

  /* Base styles for inputs (can apply to both summary and details) */
  .input {
     height: ${ROW_HEIGHT};
     padding: 0px;
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
     display: flex;
     align-items: center;
     justify-content: center;
     box-sizing: border-box;
  }
   /* Override default browser centering for text inputs */
  .input-priority, .input-percent { /* Numbers */
      justify-content: center;
      text-align: center;
      padding: 0 2px;
      appearance: textfield; -moz-appearance: textfield;
  }
  .input-hotkey, .input-percent-select { /* Selects */
      text-align: center;
      appearance: none; -webkit-appearance: none; -moz-appearance: none;
      padding: 0 2px;
  }

  /* Specific Widths for SUMMARY ROW elements */
  .rule-content .input-hotkey { width: 60px; }
  .rule-content .input-percent-select { width: 34px; border-right: none; border-top-right-radius: 0; border-bottom-right-radius: 0;}
  .rule-content .input-percent { width: 48px; border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0;}
  .rule-content .input-priority { width: 80px; } /* Added Priority width */

  /* REMOVED: .input-priority, .input-delay-action, .input-monster-*, .checkbox-container from .rule-content */


  /* --- Push buttons to the right in SUMMARY --- */
  .rule-content .button-expand {
      margin-left: auto; /* Push expand button and subsequent buttons right */
  }

  /* Button Styles (Apply to both summary and potentially details if needed) */
  .rule-button {
    font-size: 12px;
    height: ${BUTTON_SIZE};
    width: ${BUTTON_SIZE};
    display: flex;
    justify-content: center;
    align-items: center;
    border: none; background: none;
    border-top: 1px solid #757676; border-left: 1px solid #757676;
    border-bottom: 1px solid #2c2c2c; border-right: 1px solid #2c2c2c;
    color: rgb(175, 175, 175); cursor: pointer;
    flex-shrink: 0;
    &:active {
      border-top: 1px solid #2c2c2c; border-left: 1px solid #2c2c2c;
      border-bottom: 1px solid #757676; border-right: 1px solid #757676;
    }
    margin-left: 0; /* Reset margin */
  }

  .remove-rule-button { /* Specific style for remove button in summary */
    font-size: 14px;
    background: #8f000052;
    border-top: 1px solid #8b5757; border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909; border-right: 1px solid #470909;
  }

  .button-expand { /* Specific style for expand button in summary */
     font-size: 12px;
     /* Pointer events enabled by default now */
  }


  /* --- Styles for elements inside the details section --- */
  .details-inputs-grid {
      display: grid;
      grid-template-columns: auto 1fr; /* Label column, Input column */
      gap: 8px 10px; /* Row gap, Column gap */
      align-items: center;
      color: #ccc;
      font-size: 12px;
      
s
      label {
          text-align: right;
      }

      .input-group { /* For condition + value pairs */
          display: flex;
          align-items: center;
      }

      /* Adjust input heights/styles for details section */
      .input {
          height: 28px; /* Smaller height for details */
          font-size: 11px;
          background-color: #505050; /* Slightly different background */
      }
      .input-medium-number { width: 80px; height: 28px; }

      /* Align checkbox */
      input[type="checkbox"], CustomCheckbox {
         justify-self: start; /* Align checkbox to the start of the grid cell */
      }
  }


`;

export default StyledDiv; 