import styled from 'styled-components';

const StyledTargeting = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #fafafa;
  width: 100%;
  height: 100%;
  padding-top: 8px;

  h2 {
    margin-bottom: 20px;
  }

  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 10px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  label {
    min-width: 80px;
  }

  input[type='number'] {
    width: 60px;
    padding: 5px;
    background-color: #363636;
    border: 1px solid #2c2c2c;
    color: #fafafa;
  }

  .target-info {
    padding: 10px;
    p {
      margin: 5px 0;
    }
  }

  .creatures-list {
    padding: 10px;
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      padding: 2px 0;
    }
  }
`;

export default StyledTargeting;
