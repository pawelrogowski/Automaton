import styled from 'styled-components';

export const StyledScriptTable = styled.div`
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
    position: relative;
  }

  .table {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 470px; /* This might need adjustment based on actual content */
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
    position: relative;
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

  /* General styles for all editable inputs and selects */
  .td input,
  .td select {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 8px;
    box-sizing: border-box;
    background-color: rgb(35, 35, 35);
    color: #fafafa;
    font-family: monospace;
    font-size: 11px;
    border: none;
    border-radius: 0;
    outline: none;

    &:focus {
      border: 1px solid #007bff;
    }
  }

  /* Specific styles for the dropdown to make it look less like a default element */
  .td select {
    appearance: none;
  }

  .script-log-display {
    background-color: #1e1e1e;
    color: #00ff00;
    padding: 10px;
    margin: 0;
    font-family: 'Cascadia Code', 'Consolas', monospace;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px; /* Increased max-height for better visibility and scrollability */
    overflow-y: auto;
    border-top: 1px solid #444;
  }

  .expand-button {
    background: none;
    border: none;
    color: #007bff;
    cursor: pointer;
    padding: 0;
    margin-left: 5px;
    display: flex;
    align-items: center;
    &:hover {
      color: #0056b3;
    }
  }
`;

export const SectionManagementRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px;
  border-bottom: 1px solid rgb(53, 53, 53);
  flex-shrink: 0; /* Prevent shrinking */
`;

export const AddSectionButton = styled.button`
  background-color: transparent; /* Green for add */
  color: white;
  border: none;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;

  &:hover {
  }
`;

export const RemoveSectionButton = styled.button`
  background-color: transparent; /* Red for remove */
  color: white;
  border: none;
  padding: 6px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  flex-shrink: 0;

  &:hover {
  }
`;
