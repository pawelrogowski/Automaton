import styled from 'styled-components';

const ROW_HEIGHT = '38px';
const BUTTON_SIZE = '38px';

const StyledDiv = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  &:hover {
    z-index: 500;
    outline: 2px solid rgba(255, 255, 255, 0.6) !important;
  }

  .rule-content {
    display: flex;
    height: ${ROW_HEIGHT};
    align-items: center;
    background: #414141;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #555;
    border-bottom: ${({ $detailsOpen }) => ($detailsOpen ? '1px solid #555' : '1px solid #2c2c2c')};
    padding-right: 2px;
    
    > * {
      flex-shrink: 0;
    }
    
    .enable-checkbox-wrapper {
        width: 36px;
        height: ${ROW_HEIGHT};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }
  }

  .action-item-wrapper {
    width: 260px;
    height: ${ROW_HEIGHT};
    > div { width: 100%; height: 100%; }
  }

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
    justify-content: center;
    box-sizing: border-box;
    text-align: center;
    appearance: none; -webkit-appearance: none; -moz-appearance: none;
  }

  .input-text-name {
    width: 150px;
    text-align: left;
    padding-left: 5px;
  }
  
  .input-hotkey { width: 60px; }
  .input-monster-num-condition { width: 34px; border-right: none; border-top-right-radius: 0; border-bottom-right-radius: 0;}
  .input-monster-num { width: 48px; border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; appearance: textfield; -moz-appearance: textfield;}

  .input-percent-select { width: 34px; border-right: none; border-top-right-radius: 0; border-bottom-right-radius: 0;}
  .input-percent { width: 48px; border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; appearance: textfield; -moz-appearance: textfield;}
  .input-priority { width: 80px; appearance: textfield; -moz-appearance: textfield;}
  .input-delay { width: 70px; flex-grow: 0; }

  .checkbox-iswalking-wrapper.input {
    width: 36px;
    height: ${ROW_HEIGHT};
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid #16181d;
    border-left: 1px solid #79797930;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #16181d;
  }

  .button-expand {
    margin-left: auto;
  }

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
  }

  .remove-rule-button {
    font-size: 14px;
    background: #8f000052;
    border-top: 1px solid #8b5757; border-left: 1px solid #8b5757;
    border-bottom: 1px solid #470909; border-right: 1px solid #470909;
    margin-left: 2px;
  }

  .details-content-wrapper {
    padding: 12px 15px;
    background-color: #383838;
    border-left: 1px solid #555;
    border-right: 1px solid #555;
    border-bottom: 1px solid #2c2c2c;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .details-row {
    display: flex;
    align-items: center;
    gap: 10px;
    
    label {
      color: #b0b0b0;
      font-size: 11px;
      min-width: 110px;
      text-align: right;
      flex-shrink: 0;
    }

    .input,
    .checkbox-equip-empty-wrapper {
        background-color: #484848;
        height: 26px;
        border-color: #333 #666 #666 #333;
    }

    .input {
        font-size: 11px;
        color: #e0e0e0;
        flex-grow: 1;
        min-width: 60px;
        text-align: left;
    }
    .input-delay {
        width: 70px; 
        flex-grow: 0;
        text-align: center;
    }
    
    .checkbox-equip-empty-wrapper {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        height: 26px;
        padding: 0 5px;
    }
  }
`;

export default StyledDiv;
