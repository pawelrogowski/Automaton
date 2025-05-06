// Create new file: frontend/components/ActionBarRule/ActionBarRule.styled.js
import styled from 'styled-components';

// Use the same height variable as CustomIconSelect for consistency
const ROW_HEIGHT = '38px';
const BUTTON_SIZE = '38px'; // New constant for buttons

// Main styled div for the entire component (rule row + conditions area)
const StyledDiv = styled.div`
  display: flex;
  flex-direction: column; // Stack rule row and conditions vertically
  /* Remove hover outline specific to summary/details */
  /* Hover effect can be added back if desired */

  /* Removed summary styles */
  /* Removed details styles */

  /* Container for all inputs/buttons in the row */
  .rule-content {
    display: flex;
    height: ${ROW_HEIGHT};
    align-items: center;
    background: #414141;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #555; // Re-add border that was on summary
    border-bottom: 1px solid #2c2c2c; // Bottom border for the row itself

    /* Target checkbox wrapper specifically */
    > div:has(> input[type="checkbox"]):first-child { /* Keep this style */
         width: 36px;
         height: ${ROW_HEIGHT};
         display: flex;
         align-items: center;
         justify-content: center;
         flex-shrink: 0;
     }
  }

  /* Wrapper for the CustomIconSelect */
  .action-item-wrapper { /* Keep this style */
      width: 260px;
      height: ${ROW_HEIGHT};
      flex-shrink: 0;
      > div { width: 100%; height: 100%; }
  }

  /* Styles for standard inputs/selects used in this row */
  .input { /* Keep base input styles */
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
   /* Keep specific input styles */
  .input-priority, .input-delay, .input-percent, .input-monster-num { /* Keep centering */
      justify-content: center;
      text-align: center;
      padding: 0 2px;
      appearance: textfield; -moz-appearance: textfield;
  }
  .input-hotkey, .input-percent-select, .input-monster-num-condition { /* Keep centering */
      text-align: center;
      appearance: none; -webkit-appearance: none; -moz-appearance: none;
      padding: 0 2px;
  }

  /* Keep Specific Widths */
  .input-hotkey { width: 60px; }
  .input-priority { width: 80px; }
  .input-percent-select, .input-monster-num-condition {
     width: 34px; border-right: none; border-top-right-radius: 0; border-bottom-right-radius: 0;
  }
  .input-percent, .input-monster-num {
     width: 48px; border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0;
  }

  /* Button Styles */
  .rule-button { /* Keep base button styles */
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
    margin-left: 0; /* Ensure no residual margin */
  }

  /* --- Style the Conditions Toggle Button --- */
  .button-toggle-conditions {
     /* Maybe add a subtle indicator when conditions are open? */
     /* background-color: ${props => props['aria-expanded'] ? '#505050' : 'transparent'}; */
     /* Example: Using FaCog icon */
     font-size: 16px; /* Adjust icon size */
     /* Remove margin-left: auto; if it existed on the old expand button */
     margin-left: auto; /* Push toggle and remove button to the end */
  }

  /* Remove button styles */
  .remove-rule-button { /* Keep remove button styles */
    font-size: 14px;
    background: #8f000052;
    border-top: 1px solid #8b5757; border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909; border-right: 1px solid #470909;
    margin-left: 2px; // Add small space between toggle and remove buttons
  }

  /* Keep Checkbox container styles */
   .checkbox-container {
     display: flex;
     align-items: center;
     justify-content: center;
     height: ${ROW_HEIGHT};
     width: 36px;
     flex-shrink: 0;
   }

  /* --- New Styles for Conditions Container --- */
  .conditions-container {
    /* Position it below the rule row */
    /* Simple approach: it just renders below naturally */
    background-color: #363636; // Match background from CharacterStatusConditions.styled.js
    /* Add padding or borders as needed */
     border: 1px solid #555; // Match rule row border
     border-top: none; // Avoid double border with rule-content bottom border
     margin-right: calc(${BUTTON_SIZE}px + ${BUTTON_SIZE}px + 2px); // Align end before buttons - adjust as needed!

    /* Alternative: Absolute positioning (more complex) */
    /* position: absolute; */
    /* top: 100%; */ /* Position below the parent */
    /* left: 0; */
    /* width: 100%; */
    /* z-index: 10; */ /* Ensure it appears above other elements if needed */
    /* box-shadow: 0 4px 8px rgba(0,0,0,0.2); */
  }


`;

export default StyledDiv;