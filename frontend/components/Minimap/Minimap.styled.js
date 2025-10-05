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
  background-color: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1002;
  padding: 5vh;
`;

export const ModalContent = styled.div`
  background: linear-gradient(135deg, #1a1a1c 0%, #252528 100%);
  border: 1px solid #b700ff;
  border-radius: 16px;
  padding: 0;
  width: 90vw;
  height: 90vh;
  max-width: 1400px;
  max-height: 900px;
  box-shadow: 0 20px 60px rgba(183, 0, 255, 0.4), 0 0 100px rgba(183, 0, 255, 0.1);
  color: #fafafa;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const ModalHeader = styled.h2`
  font-size: 24px;
  font-weight: 600;
  color: #e0b3ff;
  margin: 0;
  padding: 24px 32px;
  text-align: center;
  text-shadow: 0 0 20px rgba(183, 0, 255, 0.6);
  background: rgba(183, 0, 255, 0.08);
  border-bottom: 1px solid rgba(183, 0, 255, 0.3);
  flex-shrink: 0;
`;

export const ControlsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px 32px;
  align-items: center;
  padding: 32px;
  overflow-y: auto;
  flex: 1;

  /* Modern scrollbar */
  &::-webkit-scrollbar {
    width: 12px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    margin: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #b700ff 0%, #8800cc 100%);
    border-radius: 10px;
    border: 2px solid transparent;
    background-clip: padding-box;

    &:hover {
      background: linear-gradient(180deg, #d000ff 0%, #a000dd 100%);
      background-clip: padding-box;
    }
  }
`;

export const SettingGroup = styled.div`
  background: rgba(183, 0, 255, 0.05);
  border: 1px solid rgba(183, 0, 255, 0.2);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const GroupTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: #d89fff;
  margin: 0 0 8px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(183, 0, 255, 0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const SettingRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  transition: background-color 0.2s ease;

  &:hover {
    background: rgba(183, 0, 255, 0.08);
  }
`;

export const ControlLabel = styled.span`
  font-size: 15px;
  padding-left: ${({ isSub }) => (isSub ? '16px' : '0')};
  color: ${({ isSub }) => (isSub ? '#c7c7c7' : '#fafafa')};
  flex: 1;
  font-weight: ${({ isSub }) => (isSub ? '400' : '500')};
`;

export const ColorInput = styled.input.attrs({ type: 'color' })`
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  width: 60px;
  height: 36px;
  background-color: transparent;
  border: 2px solid rgba(183, 0, 255, 0.3);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);

  &:hover {
    border-color: #b700ff;
    box-shadow: 0 4px 12px rgba(183, 0, 255, 0.4);
    transform: translateY(-1px);
  }

  &::-webkit-color-swatch-wrapper {
    padding: 3px;
  }

  &::-webkit-color-swatch {
    border-radius: 5px;
    border: none;
  }
  
  &::-moz-color-swatch {
    border-radius: 5px;
    border: none;
  }
`;

export const ContextMenu = styled.div`
  position: fixed;
  z-index: 1000;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid #555;
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  min-width: 180px;
  max-width: 220px;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overflow-x: hidden;

  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 0 6px 6px 0;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;

    &:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  }
`;

export const ContextMenuItem = styled.div`
  padding: 8px 16px;
  color: ${(props) => props.color || 'white'};
  font-size: 13px;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  background-color: ${(props) => (props.isHovered ? '#007ACC' : 'transparent')};
  font-weight: ${(props) => (props.bold ? 'bold' : 'normal')};
  margin-top: ${(props) => (props.separator ? '4px' : '0')};
  border-top: ${(props) => (props.separator ? '1px solid #555' : 'none')};
  transition: background-color 0.1s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background-color: ${(props) =>
      props.disabled ? 'transparent' : props.dangerHover ? '#B22222' : '#007ACC'};
  }
`;

export default StyledMinimap;
