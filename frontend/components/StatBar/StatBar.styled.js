import styled from 'styled-components';

const StyledDiv = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  > span {
    font-size: 12px;
    line-height: 0.9;
    color: #fff;
    mix-blend-mode: difference;
    white-space: nowrap;
    min-width: 42px;
    margin-left: auto;
    margin-top: -2px;
  }
  > div {
    border-top: 2px solid #2c2c2c;
    border-left: 2px solid #2c2c2c;
    border-bottom: 2px solid #757676;
    border-right: 2px solid #757676;
    height: 16px;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #1c1c1c4f;
    filter: drop-shadow(0px -1px 1px #000000);
    > div {
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
