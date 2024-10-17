import styled from 'styled-components';

export const TibiaCheckbox = styled.div`
  position: relative;
  display: inline-block;
  overflow: hidden;
  width: ${({ width }) => width}px;
  height: ${({ height }) => height}px;
  min-width: ${({ width }) => width}px;
  min-height: ${({ height }) => height}px;

  .custom-checkbox {
    display: none;
  }

  .custom-checkbox-label {
    display: inline-block;
    width: 100%;
    height: 100%;
    background-color: #363636;
    border-top: 1px solid #2c2c2c;
    border-left: 1px solid #2c2c2c;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #16181d;
    cursor: pointer;
    position: relative;
  }

  .custom-checkbox-label::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
  }

  .custom-checkbox:checked + .custom-checkbox-label {
    background-color: #363636;
  }

  .custom-checkbox:checked + .custom-checkbox-label::after {
    content: '✔';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #d3d3d3;
    font-size: ${({ width, height }) => Math.min(width, height) / 2}px;
  }

  .custom-checkbox-label:active {
    /* Add active styles */
  }
`;
