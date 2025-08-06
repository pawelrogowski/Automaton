import styled from 'styled-components';

const StyledMinimap = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background-color: rgb(26, 26, 26);
  border-radius: 4px;
  overflow: hidden;

  .minimap-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px;
    color: #fafafa;
    border-bottom: 1px solid rgb(53, 53, 53); /* Separator line */
    gap: 8px;

    button {
      background-color: rgb(26, 26, 26);
      color: #fff;
      border: 1px solid rgb(53, 53, 53);
      border-radius: 4px;
      padding: 4px;
      width: 42px;
      height: 42px;
      cursor: pointer;
      font-size: 21px;

      &:hover {
        border: 1px solid rgb(80, 80, 80);
        background-color: rgb(53, 53, 53);
      }
    }

    span {
      margin: 10px 0;
      font-size: 21px;
    }
  }
  .minimap-mode-control {
    > div:first-of-type {
      border: 1px solid rgb(53, 53, 53);
      height: 25px;
      width: 97px;
      background: none;
      font-size: 12px;
      &:hover {
        border: 1px solid rgb(80, 80, 80);
        background-color: rgb(53, 53, 53);
      }
    }
    > div:nth-child(2) {
      height: 300px;
      width: 97px;
      font-size: 12px;
    }
  }
  canvas {
    /* The canvas will automatically fill the remaining space */
    display: block; /* Removes any weird extra space below the canvas */
  }
`;

export const StyledMapControls = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
`;
export const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
`;

export const ControlButton = styled.button`
  background-color: #2d3135;
  color: #e0e0e0;
  border: none;
  // ============================= THE CHANGE: SMALLER BUTTONS =============================
  width: 32px;
  height: 32px;
  font-size: 18px; // Slightly smaller font for the new size
  // =====================================================================================
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  line-height: 1;
  border-bottom: 1px solid #4a4f54;
  transition: background-color 0.1s ease-in-out;

  &:hover {
    background-color: #3f4449;
  }

  &:last-child {
    border-bottom: none;
  }

  ${(props) => props.position === 'top' && `border-radius: 4px 4px 0 0;`}
  ${(props) => props.position === 'bottom' && `border-radius: 0 0 4px 4px;`}
  ${(props) => props.position === 'single' && `border-radius: 4px;`}

  ${(props) =>
    props.active &&
    `
    background-color: #007ACC;
    color: white;
  `}
`;

export const FloorDisplay = styled.div`
  background-color: #2d3135;
  color: #e0e0e0;
  // ============================= THE CHANGE: SMALLER DISPLAY =============================
  width: 20px;
  height: 20px;
  font-size: 12px; // Slightly smaller font to fit well
  // =====================================================================================
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  border-bottom: 1px solid #4a4f54;
`;

export default StyledMinimap;
