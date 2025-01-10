import styled from 'styled-components';
import tibiaBg from '../../assets/tibiaBg.webp';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

export const StyledDiv = styled.div`
  z-index: 1000;
  width: 100vw;
  height: 100vh;
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  justify-content: center;
  align-items: center;

  > div {
    position: relative;
    background: url(${tibiaBgDark});
    background-repeat: repeat;
    width: 245px;
    height: 131px;
    border-top: solid 2px rgb(120, 120, 120);
    border-left: solid 2px rgb(120, 120, 120);
    border-bottom: solid 2px rgb(39, 39, 39);
    border-right: solid 2px rgb(39, 39, 39);
    padding-top: 14px;
    > .title-text {
      position: absolute;
      display: flex;
      justify-content: center;
      align-items: center;
      top: 1px;
      left: 1px;
      background: url(${tibiaBgDark});
      width: 100%;
      height: 14px;
      margin-left: auto;
      margin-right: auto;
      border-right: solid 2px rgb(39, 39, 39);
      border-bottom: solid 1px rgb(39, 39, 39);
      color: rgb(120, 120, 120);
      font-size: 11px;
      line-height: 1;
      letter-spacing: -0.2px;
    }
    > div {
      width: 100%;
      height: 100%;
      background: url(${tibiaBg});
      display: flex;
      justify-content: center;
      background: url(${tibiaBgDark});
      padding: 0 0px 1px 0px;
      /* border-left: solid 2px rgb(61, 61, 61);
      border-bottom: solid 2px rgb(61, 61, 61);
      border-right: solid 2px rgb(61, 61, 61); */
      > .inner-border-wrapper {
        background: url(${tibiaBg});
        padding: 11px 12px;
        width: 100%;
        height: 100%;
        border-right: solid 1px rgb(120, 120, 120);
        border-bottom: solid 1px rgb(120, 120, 120);
        border-right: solid 1px rgb(39, 39, 39);
        > .content-wrapper {
          display: flex;
          flex-direction: column;

          > .top-content {
            height: 55px;
            border-bottom: solid 1px rgb(39, 39, 39);
            > p {
              font-size: 11px;
              color: rgb(180, 180, 180);
            }
          }
          > .bot-content {
            display: flex;
            width: 100%;
            border-top: solid 1px rgb(120, 120, 120);
            > div {
              padding-top: 8px;
              display: flex;
              flex-direction: row;
              gap: 5px;
              height: 31;
              margin-left: auto;
            }
          }
        }
      }
    }
  }
  .confirm-button {
    background-repeat: repeat;
    height: 22px;
    padding: 3px;
    text-align: center;
    display: flex;
    justify-content: center;
    align-items: center;
    color: rgb(180, 180, 180);
    background: url(${tibiaBg});
    border-top: 1px solid #757676;
    border-left: 1px solid #757676;
    border-bottom: 1px solid #2c2c2c;
    border-right: 1px solid #2c2c2c;
    font-size: 11px;

    &:active {
      background: url(${tibiaBgDark});
      border-top: 1px solid #2c2c2c;
      border-left: 1px solid #2c2c2c;
      border-bottom: 1px solid #757676;
      border-right: 1px solid #757676;
    }
    &:hover {
      cursor: pointer;
    }
  }
`;
