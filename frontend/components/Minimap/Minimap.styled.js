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
      width: 25px;
      height: 25px;
      cursor: pointer;
      font-size: 11px;

      &:hover {
        border: 1px solid rgb(80, 80, 80);
        background-color: rgb(53, 53, 53);
      }
    }

    span {
      margin: 10px 0;
      font-size: 11px;
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
export const StyledPlayerMarker = styled.div.attrs((props) => ({
  style: {
    width: `${props.size}px`,
    height: `${props.size}px`,
  },
}))`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 10;

  &::before,
  &::after {
    content: '';
    position: absolute;
    background-color: #ffffff;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
  }

  &::before {
    top: 0;
    left: 50%;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
  }

  &::after {
    top: 50%;
    left: 0;
    width: 100%;
    height: 2px;
    transform: translateY(-50%);
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
  width: 20px;
  height: 20px;
  font-size: 14px; // Slightly smaller font for the new size
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
