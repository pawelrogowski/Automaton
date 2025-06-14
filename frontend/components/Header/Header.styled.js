import styled from 'styled-components';

const StyledHeader = styled.header`
  width: 100%;
  height: 36px;
  display: flex;
  flex-direction: row;
  justify-content: space-evenly;

  gap: 0;
  > a {
    display: flex;
    justify-content: center;
    width: 100%;
    font-size: 14px;
    color: #909090;
  }
`;

export default StyledHeader;
