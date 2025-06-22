import styled from 'styled-components';

export const StyledWaypointTable = styled.div`
  font-family: monospace !important;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  /* overflow: hidden; */
  border: 1px solid rgb(53, 53, 53);
  background-color: rgb(26, 26, 26);
  color: #fafafa;
  font-size: 11px;
  border-radius: 4px;
  overflow: hidden;

  /* The main table container is StyledWaypointTable itself */
  .tbody .tr.selected {
    background-color: rgb(0, 52, 109); // A nice highlight color
    color: white; // Make text readable on the dark background
  }
  .table {
    /* This is the div that wraps the header and body, receiving getTableProps() */
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 470px;
  }

  /* Header group */
  .thead {
    /* This is the div that wraps the header row, added in JSX */
    background-color: rgb(26, 26, 26);
    border-bottom: 1px solid rgb(53, 53, 53);
    flex-shrink: 0; /* Prevent header from shrinking */
  }

  /* Table body */
  .tbody {
    /* This is the div that wraps the rows, added in JSX */
    flex-grow: 1;
    overflow-y: auto; /* Allow vertical scrolling for body */
  }

  .tr {
    /* This applies to both header rows and data rows */
    display: flex;
    width: 100%;
    border-bottom: 1px solid rgb(53, 53, 53);
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
    /* Removed position: relative; and flex-shrink: 0; as they are handled by react-table's inline styles or parent flex */

    &:last-child {
      border-right: none;
    }
  }

  .tr.selected {
    background-color: #007bff; /* Highlight color for selected row */
    color: white;
  }

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
`;
