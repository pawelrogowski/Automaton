import styled from 'styled-components';

export const StyledWaypointTable = styled.div`
  height: 500px;
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
  .tbody .tr.active-bot-wp::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 12px 12px 0 0;
    border-color: #b700ff transparent transparent transparent;
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

  /* Specific styles for the container of the coordinate inputs */
  .td .coord-editor {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
    padding: 4px 8px;
    gap: 4px;
    box-sizing: border-box;
  }

  /* The individual x, y, z inputs within the special editor */
  .coord-editor input {
    position: static;
    flex: 1;
    width: 100%;
    height: 100%;
    padding: 0 4px;
    text-align: center;
    border-radius: 2px;
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

export const SectionButtonsContainer = styled.div`
  display: flex;
  flex-wrap: nowrap; /* Keep buttons in a single line */
  overflow-x: auto; /* Allow horizontal scrolling if many sections */
  gap: 5px;
  padding-right: 10px; /* Space before add/remove buttons */
  -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */

  /* Hide scrollbar for a cleaner look */
  scrollbar-width: none; /* Firefox */
  &::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
`;

export const SectionButton = styled.button`
  background-color: ${(props) =>
    props.active ? 'transparent' : 'transparent'};
  color: white;
  border: none;
  padding: 6px 10px; /* Slightly smaller padding for more compact buttons */
  border-radius: ${(props) => (props.active ? '0px' : '3px')};
  cursor: pointer;
  font-size: 12px; /* Smaller font size */
  white-space: nowrap; /* Prevent text wrapping */
  flex-shrink: 0; /* Prevent buttons from shrinking */
  border-bottom: 1px solid
    ${(props) => (props.active ? '#b700ff' : 'transparent')};
  &:hover {
    background-color: ${(props) => (props.active ? '#b700ff' : 'transparent')};
    border-radius: 3px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
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

export const SectionNameInput = styled.input`
  padding: 6px 8px; /* Smaller padding */
  border-radius: 3px;
  border: 1px solid #b700ff;
  background-color: trsnaprent;
  color: white;
  width: 100px; /* Fixed width for consistency */
  flex-shrink: 0;
`;

export const ModeSwitchButton = styled.button`
  background: none;
  border: 1px solid #4a4a4a;
  color: #ccc;
  padding: 5px;
  margin-right: 10px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease-in-out;

  &:hover {
    color: #fff;
    border-color: #6a6a6a;
    background-color: #3a3a3a;
  }

  // Use the 'active' prop to change style
  ${({ active }) =>
    active &&
    `
    color: #00bfff;
    border-color: #00bfff;
    background-color: #2c3e50;
  `}
`;
