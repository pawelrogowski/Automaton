import styled from 'styled-components';

const StyledDiv = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;

  > span {
    font-size: 13px;
    line-height: 0.5;
    color: #fff;
    mix-blend-mode: difference;
    white-space: nowrap;
    min-width: 42px;
    margin-left: auto;
    margin-top: -2px;
    text-align: right;
  }
  > div {
    border-radius: 22px;
    border-top: 1px solid #2c2c2c;
    border-left: 1px solid #2c2c2c;
    border-bottom: 1px solid #757676;
    border-right: 1px solid #2c2c2c;
    height: 16px;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #1c1c1c4f;
    filter: drop-shadow(0px -1px 1px rgba(0, 0, 0, 0.5));
    > div {
      border-radius: 16px;
      position: absolute;
      top: 50%;
      left: 0;
      background: ${(props) => props.$fill};
      height: 100%;
      transform: translateY(-50%);
      width: ${(props) => props.$value || 0}%;
    }
  }
`;

export default StyledDiv;
