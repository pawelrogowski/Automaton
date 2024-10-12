import styled from 'styled-components';

export const StyledDiv = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  margin-top: 2px;
  .health-bar,
  .mana-bar {
    display: flex;
    gap: 6px;

    > svg {
      margin-left: auto;
      width: 16px;
      height: 16px;
    }
  }

  .hp-icon {
    stroke: none;
    fill: #ff1c1c;
    margin-left: auto;
    filter: drop-shadow(0px 1px 1px #000000);
    rotate: 4deg;
  }
  .mp-icon {
    stroke: none;
    fill: #0066ff;
    filter: drop-shadow(0px 1px 1px #000000);
    rotate: 18deg;
    margin-left: auto;
  }
`;
