import styled from 'styled-components';

export const StyledValueControl = styled.div`
  display: flex;
  flex-direction: row; /* Arrange children horizontally */
  align-items: center; /* Align items vertically in the middle */
  gap: 8px; /* Space between label and input */
  padding: 4px 8px; /* Smaller padding */
  background-color: rgb(26, 26, 26);
  border: 1px solid rgb(53, 53, 53);
  border-radius: 4px;
  color: #fafafa;
  font-size: 12px;
  height: 32px; /* Fixed height to match other controls */
`;

export const ControlLabel = styled.label`
  font-weight: bold;
  white-space: nowrap; /* Prevent label from wrapping */
`;

export const ControlInput = styled.input`
  width: 40px; /* Fixed width for the input */
  padding: 4px 6px; /* Smaller padding */
  border-radius: 3px;
  border: 1px solid rgb(53, 53, 53);
  background-color: rgb(35, 35, 35);
  color: #fafafa;
  font-family: monospace;
  font-size: 12px;
  outline: none;
  text-align: center; /* Center the text */

  &:focus {
    border-color: #b700ff;
  }
`;
