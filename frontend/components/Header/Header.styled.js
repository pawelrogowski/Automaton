import styled from 'styled-components';

const StyledHeader = styled.header`
  width: 100%;
  height: 36px;
  border-bottom: solid 1px rgb(113, 113, 113);
  border-right: solid 1px rgb(113, 113, 113);
  border-top: solid 1px rgb(0, 0, 0);
  border-left: solid 1px rgb(0, 0, 0);
  display: flex;
  flex-direction: row;
  justify-content: space-evenly;

  gap: 0;
  > a {
    display: flex;
    justify-content: center;
    width: 100%;
    font-size: 20px;
    color: #909090;
  }
`;

export default StyledHeader;
