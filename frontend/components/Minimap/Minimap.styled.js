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

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.75);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1002;
`;

export const ModalContent = styled.div`
  background: #1c1c1e;
  border: 1px solid #b700ff;
  border-radius: 12px;
  padding: 25px;
  width: 450px;
  max-width: 95%;
  box-shadow: 0 8px 32px rgba(183, 0, 255, 0.3);
  color: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

export const ModalHeader = styled.h2`
  font-size: 22px;
  font-weight: bold;
  color: #d89fff;
  margin: 0;
  text-align: center;
  text-shadow: 0 0 8px rgba(183, 0, 255, 0.5);
`;

export const ControlsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 16px;
  align-items: center;
`;

export const ControlLabel = styled.span`
  font-size: 16px;
  padding-left: ${({ isSub }) => (isSub ? '20px' : '0')};
  color: ${({ isSub }) => (isSub ? '#c7c7c7' : '#fafafa')};
`;

export const ColorInput = styled.input.attrs({ type: 'color' })`
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  width: 50px;
  height: 28px;
  background-color: transparent;
  border: 1px solid #444;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: #b700ff;
  }

  &::-webkit-color-swatch {
    border-radius: 4px;
    border: none;
  }
  &::-moz-color-swatch {
    border-radius: 4px;
    border: none;
  }
`;

export default StyledMinimap;
