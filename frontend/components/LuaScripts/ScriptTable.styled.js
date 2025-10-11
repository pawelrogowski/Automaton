import styled from 'styled-components';

export const StyledScriptTable = styled.div`
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu',
    sans-serif;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  border: none;
  background-color: transparent;
  color: #fafafa;
  font-size: 13px;
  border-radius: 0;
  overflow: hidden;
  margin: 0 24px 24px 24px;

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
    background-color: rgb(30, 30, 30);
    border: 1px solid rgb(60, 60, 60);
    border-radius: 8px;
    overflow: hidden;
  }

  .thead {
    background-color: rgb(40, 40, 40);
    border-bottom: 1px solid rgb(60, 60, 60);
    flex-shrink: 0;
  }

  .tbody {
    flex-grow: 1;
    overflow-y: auto;
    background-color: rgb(30, 30, 30);

    &::-webkit-scrollbar {
      width: 10px;
    }

    &::-webkit-scrollbar-track {
      background: rgb(30, 30, 30);
    }

    &::-webkit-scrollbar-thumb {
      background: rgb(60, 60, 60);
      border-radius: 4px;

      &:hover {
        background: rgb(80, 80, 80);
      }
    }
  }

  .tr {
    display: flex;
    width: 100%;
    border-bottom: 1px solid rgba(60, 60, 60, 0.3);
    min-height: 48px;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: rgba(255, 255, 255, 0.03);
    }

    &:last-child {
      border-bottom: none;
    }
  }

  .th,
  .td {
    padding: 12px 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-sizing: border-box;
    position: relative;
    display: flex;
    align-items: center;
  }

  .th {
    font-weight: 600;
    text-align: left;
    justify-content: space-between;
    color: #aaa;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
  gap: 10px;
  padding: 16px 24px;
  background-color: rgb(30, 30, 30);
  border-bottom: 1px solid rgb(60, 60, 60);
  flex-shrink: 0;
`;

export const AddSectionButton = styled.button`
  background-color: rgba(255, 255, 255, 0.05);
  color: #fafafa;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu',
    sans-serif;

  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
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
