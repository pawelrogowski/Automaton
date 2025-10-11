import styled from 'styled-components';

export const StyledDiv = styled.div`
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  flex-direction: column;
  padding: 5px;
  padding-top: 20px;
  max-height: 498px;
  overflow-y: auto;

  .blackbox {
    border: 1px solid rgba(255, 255, 255, 0.18);
  }
  .title {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 15px;
    font-size: 14px;
    line-height: 1;
    color: #909090;
    display: flex;
    justify-content: center;
    align-items: center;
    background-repeat: repeat;
    border-bottom: 1px solid #292a29;
  }
  .wrapped-content {
    padding: 4px;
    display: flex;
  }
`;
