import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';
import tibiaBgDark from '../assets/tibiaBgDark.webp';

const StyledDiv = styled.div`
  display: flex;
  flex-direction: column;
  /* background-image: url(${tibiaBg});
  background-repeat: repeat; */
  border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 2px solid #2c2c2c;
  border-right: 2px solid #2c2c2c;

  .side-main {
    display: flex;
    flex-direction: row;
    background-image: url(${tibiaBg});
    gap: 5px;
  }
  .aside {
    height: 510px;
    width: 195px;
  }
  > .title {
    width: calc(100vw -1px);
    height: 15px;
    font-size: 10px;
    color: #909090;
    display: flex;
    justify-content: center;
    align-items: center;
    background-image: url(${tibiaBgDark});
    background-repeat: repeat;
    border-bottom: 1px solid #292a29;
  }
  > .helper-wrapper {
    background-image: url(${tibiaBg});
    background-repeat: repeat;
    /* border-top: 2px solid #757676; */
    border-left: 1px solid #343434;
    border-bottom: 1px solid #343434;
    border-right: 1px solid #343434;
    padding: 0;
    margin: 0;
    display: block;
  }
  .helper-wrapper2 {
    padding: 12px 12px;
    /* border-top: 2px solid #757676; */
    border-left: 1px solid #2b2c2c;
    border-bottom: 1px solid #2b2c2c;
    border-right: 1px solid #5f6161;
    > header {
      width: 100%;
      height: 36px;
      border-bottom: solid 1px rgb(113, 113, 113);
      border-right: solid 1px rgb(113, 113, 113);
      border-top: solid 1px rgb(0, 0, 0);
      border-left: solid 1px rgb(0, 0, 0);
      display: flex;
      flex-direction: row;
      gap: 0;
      > a {
        font-size: 20px;
        color: #909090;
      }
    }
  }
  .main-content {
    padding: 5px 0px 5px 0px;
    padding-bottom: 0px;
  }
`;
export default StyledDiv;
