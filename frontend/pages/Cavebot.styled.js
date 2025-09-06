import styled from 'styled-components';

const StyledCavebot = styled.div`
  display: flex;
  flex-direction: row; /* Arrange children horizontally */
  gap: 10px; /* Add some space between the table and minimap */
  color: #fafafa;
  width: 100%; /* Ensure it takes full width */
  height: 100%; /* Ensure it takes full height */
  justify-content: center; /* Center content horizontally */
  align-items: flex-start; /* Align items to the start of the cross axis */
  padding-top: 8px;
  h2 {
    margin-bottom: 20px;
  }

  .minimap-controls-container {
    display: flex;
    flex-direction: column;
    gap: 10px; /* Space between minimap and the new control */
    flex-shrink: 0; /* Prevent container from shrinking */
  }

  .minimap-container {
    border: 1px solid #333;
    background-color: #1a1a1a;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    flex-shrink: 0; /* Prevent minimap from shrinking */
  }
`;

export default StyledCavebot;
