// CustomCheckbox.styled.js
import styled from 'styled-components';

export const TibiaCheckbox = styled.div`
  position: relative;
  display: inline-block;
  overflow: hidden;
  height: ${({ size }) => size}px;
  width: ${({ size }) => size}px;
  min-width: ${({ size }) => size}px;
  min-height: ${({ size }) => size}px;

  .custom-checkbox {
    display: none;
  }

  .custom-checkbox-label {
    display: inline-block;
    width: ${({ size }) => size}px;
    height: ${({ size }) => size}px;
    background-color: #363636;
    border-top: 1px solid #2c2c2c;
    border-left: 1px solid #2c2c2c;
    border-bottom: 1px solid #79797930;
    border-right: 1px solid #2b2b2b;
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
    background-color: #363636; /* Change the background color when checked */
  }

  .custom-checkbox:checked + .custom-checkbox-label::after {
    content: '✔'; /* Checkmark symbol */
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #d3d3d3;
    font-size: ${({ size }) => size / 2}px;
  }

  .custom-checkbox-label:active {
    /* Add active styles */
  }
`;
