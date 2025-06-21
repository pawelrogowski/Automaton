import styled from 'styled-components';

const StyledMinimap = styled.div`
  /* --- The Main Fix --- */
  /* Use Flexbox to arrange children vertically */
  display: flex;
  flex-direction: column;
  background-color: #333; /* A dark background for the control area */
  border: 1px solid #555;
  border-radius: 4px; /* Optional: adds rounded corners */
  overflow: hidden; /* Ensures canvas doesn't bleed out */

  .minimap-controls {
    /* Arrange the controls themselves horizontally */
    display: flex;
    justify-content: space-around; /* Spreads out the items */
    align-items: center;
    padding: 8px;
    color: #eee; /* Light text color for contrast */
    border-bottom: 1px solid #555; /* Separator line */

    button {
      background-color: #555;
      color: #fff;
      border: 1px solid #777;
      border-radius: 3px;
      padding: 4px 8px;
      cursor: pointer;
      font-weight: bold;

      &:hover {
        background-color: #666;
      }
    }

    span {
      margin: 0 10px;
      font-family: monospace; /* Makes the number look nice */
      font-size: 14px;
    }
  }

  .minimap-lock-control {
    display: flex;
    align-items: center;
    gap: 6px; /* Space between checkbox and label */

    label {
      cursor: pointer;
      font-size: 14px;
    }

    input[type='checkbox'] {
      cursor: pointer;
    }
  }

  canvas {
    /* The canvas will automatically fill the remaining space */
    display: block; /* Removes any weird extra space below the canvas */
  }
`;

export default StyledMinimap;
