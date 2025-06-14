import styled from 'styled-components';

export const StyledDiv = styled.div`
  border-radius: 10px;
  padding: 1px;
  display: flex;
  flex-direction: column;
  .title {
    width: 100%;
    height: 18px;
    font-size: 14px;
    color: #909090;
    display: flex;
    justify-content: center;
    align-items: center;
    background-repeat: repeat;
    border-bottom: 1px solid black;
    line-height: 1;
  }
  .wrapped-content {
    display: flex;
  }
`;
