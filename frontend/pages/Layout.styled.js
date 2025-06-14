import styled from 'styled-components';

const StyledDiv = styled.div`
  display: flex;
  flex-direction: column;
  padding: 12px 12px;
  height: 100vh;
  overflow-x: hidden;

  .side-main {
    display: flex;
    flex-direction: row;
    gap: 12px;
    height: 100%;
  }
  .aside {
    height: 517px;
    width: 195px;
  }
  .main-content {
    padding: 5px 0px 5px 0px;
    padding-bottom: 0px;
    width: 100%;
    ol {
      font-size: {
        font-size: 13px;
      }
    }
  }
  .checkbox-wrapper {
    display: flex;
    gap: 10px;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    padding-bottom: 5px;
    border-bottom: solid 1px #5f6161;
    margin: 5px 0px;
    > span {
      text-align: center;
      color: #fafafa;
      padding: 0 3px;
      text-justify: center;
      width: 100%;
      font-size: 11px;
    }
  }
  .button-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    button {
      color: #fafafa;
      background: transparent;
      background-repeat: repeat;
      font-size: 11px;
      cursor: pointer;
      border-radius: 10px;
      border: 1px solid rgba( 255, 255, 255, 0.18 );

      &:active {
        border-radius: 10px;
        border: 1px solid rgba( 255, 255, 255, 0.18 );
      }
    }
  }
  .save-load-buttons {
    display: flex;
    flex-direction: row;
    justify-content: space-evenly;
    gap: 2px;
  }
  .add-button {
    width: 100%;
  }
  .load-button,
  .save-button {
    width: 50%;
  }
  .UMP-image {
    img {
      margin-left: -3px;
      margin-top: -4px;
    }
  }
  .SSA-image {
    img {
      margin-left: 0px;
      margin-top: -2px;
    }
  }

  // --- Slider Styles ---
  .slider-container {
    padding: 10px 0px;
    margin-top: auto;
    border-top: 1px solid #5f6161; // Separator line
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;

    label {
      font-size: 9px;
      color: #fafafa;
      text-align: center;
    }

    input[type='range'] {
      -webkit-appearance: none; // Override default look
      appearance: none;
      width: 90%; // Adjust width as needed
      height: 8px; // Slider track height
      background: rgb(83 83 83); // Track background
      border-radius: 5px;
      outline: none;
      cursor: pointer;

      // Thumb styles (Chrome, Edge, Safari)
      &::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px; // Thumb width
        height: 16px; // Thumb height
        background: #909090; // Thumb color
        border: 1px solid #2c2c2c;
        border-radius: 50%; // Make it round
        cursor: pointer;
      }

      // Thumb styles (Firefox)
      &::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: #909090;
        border: 1px solid #2c2c2c;
        border-radius: 50%;
        cursor: pointer;
      }

      &:disabled {
          cursor: not-allowed;
          opacity: 0.5;
      }

       &:disabled::-webkit-slider-thumb {
           cursor: not-allowed;
       }
       &:disabled::-moz-range-thumb {
           cursor: not-allowed;
       }
    }
  }
  // --- End Slider Styles ---
`;
export default StyledDiv;
