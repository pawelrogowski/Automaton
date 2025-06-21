import styled from 'styled-components';

const StyledCavebot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fafafa;

  h2 {
    margin-bottom: 20px;
  }

  .minimap-container {
    border: 1px solid #333;
    background-color: #1a1a1a;
    display: flex;
    justify-content: center;
    align-items: center;
    align-self: flex-end;
    overflow: hidden;
  }
`;

export default StyledCavebot;
