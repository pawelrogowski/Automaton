import styled from 'styled-components';

const StyledDiv = styled.div`
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 12px;
  background: #1a1d21;

  position: relative;
  box-shadow:
    rgba(6, 24, 44, 0.4) 0px 0px 0px 2px,
    rgb(1 1 4 / 44%) 0px 4px 6px -1px,
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
    margin-top: 4px;
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
  }
  .details-arrow {
    transition: stroke 200ms;
    stroke: #fafafa;
    &:hover {
      stroke: #0066ff;
    }
  }
  .details-wrapper {
    padding-top: 10px;
  }
  .pick-pixel-button {
    padding: 0;

    svg {
      stroke: #fafafa;
      transition: stroke 200ms;
    }
    svg:hover {
      stroke: #0066ff;
    }
  }
  .conditions-header {
    color: #fafafa;
    font-size: 14px;
    padding: 4px;
  }
  .picked-color-wrapper {
    display: flex;
    gap: 8px;
    align-items: center;
    &:not(:last-of-type) {
      padding-bottom: 5px;
      border-bottom: 1px solid #44444b;
    }
    &:not(:first-of-type) {
      padding-top: 5px;
    }
  }
  .remove-color-icon,
  .remove-rule-icon {
    transition: stroke 200ms;
    stroke: #fafafa;
    &:hover {
      cursor: pointer;
      stroke: #bf2828;
    }
  }
  .remove-color {
    margin-left: auto;
  }
  .conditions-header-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    svg {
      margin-bottom: 4px;
    }
  }
  .coordinate-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    list-style: none;
    padding: 0;
    min-width: 45px;
    > li {
      font-size: 9px;
      color: #fafafa;
    }
  }
`;

export default StyledDiv;
