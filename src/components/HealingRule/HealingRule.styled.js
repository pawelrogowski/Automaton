import styled from 'styled-components';

const StyledDiv = styled.div`
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 12px;
  background: #2f363d;
  box-shadow:
    rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
    rgba(6, 24, 44, 0.65) 0px 4px 6px -1px,
    rgba(255, 255, 255, 0.08) 0px 1px 0px inset;
  summary {
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .input-wrapper {
    position: relative;
  }
  .input-wrapper-checkbox {
    position: relative;
    height: 32px;
    margin-left: auto;
  }
  .input {
    width: 100px;
    height: 32px;
    padding: 0 12px;
    background: #24292e;
    font-size: 12px;
    border: none;
    border-radius: 4px;
    color: #d3d3d3;
    outline: none;
  }
  .input-checkbox {
    width: 32px;
    background: #24292e;
  }
  .label {
    position: absolute;
    top: -7px;
    left: 8px;
    font-size: 10px;
    background: #24292e;
    padding: 0 4px;
    border-radius: 4px;
    color: #7c8085;
  }
  button {
    display: flex;
    justify-content: center;
    align-items: center;
    border: none;
    background: none;
    stroke: #c5c5c5;
    svg {
      transition: stroke 200ms;
      stroke: #c5c5c5;
    }
    &:hover {
      cursor: pointer;
      > svg {
        stroke: #bf2828;
      }
    }
  }
  .details-arrow {
    transition: stroke 200ms;
    stroke: #c5c5c5;
    &:hover {
      stroke: #0066ff;
    }
  }
`;

export default StyledDiv;
