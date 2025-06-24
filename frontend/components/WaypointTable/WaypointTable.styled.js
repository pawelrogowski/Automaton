import styled from 'styled-components';

export const StyledWaypointTable = styled.div`
  font-family: monospace !important;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid rgb(53, 53, 53);
  background-color: rgb(26, 26, 26);
  color: #fafafa;
  font-size: 11px;
  border-radius: 4px;
  overflow: hidden;

  .tbody .tr.selected {
    background-color: rgb(0, 52, 109);
    color: white;
  }
  .tbody .tr {
    // ... all your existing .tr styles ...
    position: relative; // This is crucial for positioning the ribbon
  }
  .tbody .tr.active-bot-wp::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    // Creates the triangle shape
    border-style: solid;
    border-width: 12px 12px 0 0;
    // The color of the ribbon
    border-color: rgba(183, 0, 255, 0.84) transparent transparent transparent;
    // A subtle shadow to make it pop
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
  }

  .table {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 470px;
  }

  .thead {
    background-color: rgb(26, 26, 26);
    border-bottom: 1px solid rgb(53, 53, 53);
    flex-shrink: 0;
  }

  .tbody {
    flex-grow: 1;
    overflow-y: auto;
  }

  .tr {
    display: flex;
    width: 100%;
    border-bottom: 1px solid rgb(53, 53, 53);
    max-height: 35.5px;
    &:hover {
      background-color: rgb(53, 53, 53);
    }
    &:last-child {
      border-bottom: none;
    }
  }

  .th,
  .td {
    padding: 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-sizing: border-box;
    /* *** MODIFICATION: Added position relative *** */
    /* This is crucial for positioning the editable inputs perfectly inside the cell */
    position: relative;
  }

  /* .tr.selected is defined above, this one is redundant */
  /* .tr.selected {
    background-color: #007bff;
    color: white;
  } */

  .th {
    font-weight: bold;
    text-align: left;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .resizer {
    display: inline-block;
    background: transparent;
    width: 2px;
    height: 100%;
    position: absolute;
    right: 0;
    top: 0;
    transform: translateX(50%);
    z-index: 1;
    touch-action: none;

    &.isResizing {
      background: #007bff;
    }
  }

  button {
    background-color: #5f6161;
    color: #fafafa;
    border: none;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 3px;

    &:hover {
      background-color: #7a7a7a;
    }
  }

  /* --- NEW STYLES FOR EDITABLE CELLS --- */

  /* General styles for all editable inputs and selects */
  .td input,
  .td select {
    /* Positioning to perfectly overlay the parent TD */
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    /* Take over the padding from the TD */
    padding: 8px;
    box-sizing: border-box;

    /* Reset browser defaults and apply theme */
    background-color: rgb(35, 35, 35); /* Slightly lighter to indicate it's an input */
    color: #fafafa;
    font-family: monospace;
    font-size: 11px;
    border: none;
    border-radius: 0;
    outline: none; /* We will use border for focus instead */

    &:focus {
      /* Use the theme's highlight color for the focus border */
      border: 1px solid #007bff;
    }
  }

  /* Specific styles for the dropdown to make it look less like a default element */
  .td select {
    appearance: none; /* Remove default dropdown arrow on some browsers */
  }

  /* Specific styles for the container of the coordinate inputs */
  .td .coord-editor {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    display: flex;
    align-items: stretch; /* Make inputs fill the height of the cell */
    padding: 4px 8px; /* Slightly less vertical padding to fit nicely */
    gap: 4px; /* Space between the x, y, z inputs */
    box-sizing: border-box;
  }

  /* The individual x, y, z inputs within the special editor */
  .coord-editor input {
    /* These inputs are in a flex container, so they don't need absolute positioning */
    position: static;
    flex: 1; /* Distribute width equally */
    width: 100%; /* Required for flex to work correctly in some cases */
    height: 100%;

    /* Reset padding since the container has it */
    padding: 0 4px;

    text-align: center;
    border-radius: 2px; /* Give them a slight rounding */
  }
`;
