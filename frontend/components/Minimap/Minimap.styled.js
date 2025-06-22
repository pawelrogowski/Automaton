import styled from 'styled-components';

const StyledMinimap = styled.div`
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

export default StyledMinimap;
