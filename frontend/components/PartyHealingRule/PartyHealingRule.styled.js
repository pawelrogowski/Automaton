import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';

const ROW_HEIGHT = '38px'; // Consistent row height
const BUTTON_SIZE = '38px'; // Consistent button size

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

  /* Wrapper for the CustomIconSelect */
  .action-item-wrapper {
      width: 162px; /* Action Item width (same as action bar) */
      height: ${ROW_HEIGHT};
      flex-shrink: 0;
      > div { /* Ensure select trigger fills wrapper */
         width: 100%;
         height: 100%;
      }
  }

  /* Generic input/select styles */
  .input {
     height: ${ROW_HEIGHT};
     padding: 0px;
     font-size: 11px;
     line-height: 1;
     border: none;
     color: #d3d3d3;
     background: #414141;
     outline: none;
     border-top: 1px solid #16181d;
     border-left: 1px solid #79797930;
     border-bottom: 1px solid #79797930;
     border-right: 1px solid #16181d;
     display: flex;
     align-items: center;
     justify-content: center; /* Center text */
     text-align: center; /* Ensure text aligns center */
     box-sizing: border-box;
     appearance: none; -webkit-appearance: none; -moz-appearance: none; /* Remove default styles */
  }
  /* Remove arrows from number inputs */
   input[type=number] {
     -moz-appearance: textfield;
   }
   input[type=number]::-webkit-outer-spin-button,
   input[type=number]::-webkit-inner-spin-button {
     -webkit-appearance: none;
     margin: 0;
   }

  /* Specific Widths for Party Heal Row */
  .input-hotkey {
    width: 60px;
  }
  .input-party-position {
    width: 126px; /* Kept the width, adjust if needed for select dropdown */
    /* Add text-align: left if centered text looks odd for "Any" */
    /* text-align: left; */
    /* padding-left: 8px; */ /* Add padding if text is too close to edge */
  }
  .input-percent-select {
     width: 50px; /* Condition select width */
     border-right: none;
     border-top-right-radius: 0;
     border-bottom-right-radius: 0;
     cursor: not-allowed; /* Indicate disabled */
  }
  .input-percent { /* Friend HP % input */
     width: 62px; /* Value input width */
     border-left: none;
     border-top-left-radius: 0;
     border-bottom-left-radius: 0;
  }
  .input-priority {
    width: 80px;
  }
  .input-delay {
    width: 100px; /* Align with action bar delay */
    /* margin-left: auto; */ /* Pushed by placeholder */
  }


  /* Button Styles (copied from ActionBarRule.styled.js) */
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
    margin-left: 0;
  }

  .remove-rule-button {
    font-size: 14px;
    background: #8f000052;
    border-top: 1px solid #8b5757; border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909; border-right: 1px solid #470909;
  }

  .button-expand {
     font-size: 12px;
     margin-left: auto;
  }

  /* Checkbox Container Styling (for RequireAttackCooldown etc.) */
   .checkbox-container {
     display: flex;
     align-items: center;
     justify-content: center;
     height: ${ROW_HEIGHT};
     width: 36px; /* Consistent width */
     flex-shrink: 0;
     /* Add borders if needed */
      border-top: 1px solid #16181d;
      border-left: 1px solid #79797930;
      border-bottom: 1px solid #79797930;
      border-right: 1px solid #16181d;
   }
   /* Specific class for require attack cooldown checkbox container */
   .checkbox-require-atk {
       width: 83px; /* Adjust width if needed */
   }
   .checkbox-is-walking { /* If you add the walking checkbox */
       width: 36px;
   }

`;

export default StyledDiv;
