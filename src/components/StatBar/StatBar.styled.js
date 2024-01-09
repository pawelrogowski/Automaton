import styled from 'styled-components';

const StyledDiv = styled.div`
  display: flex;
  gap: 12px;

  > span {
    font-size: 16px;
    color: #fff;
    mix-blend-mode: difference;
    white-space: nowrap;
    min-width: 38px;
  }
  > div {
    box-shadow:
      rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
      rgb(1 1 4 / 44%) 0px 4px 6px -1px,
      rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
    height: 26px;
    width: 100%;
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;

    > div {
      position: absolute;
      top: 50%;
      left: 0;
      background: ${(props) => props.$fill};
      border-radius: 12px;
      height: 88%;
      transform: translateY(-50%);
      width: ${(props) => props.$value || 0}%;
      box-shadow:
        rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
        rgb(1 1 4 / 44%) 0px 4px 6px -1px,
        rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
    }
  }
`;

export default StyledDiv;
