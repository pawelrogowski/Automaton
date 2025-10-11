import styled from 'styled-components';

export const TibiaCheckbox = styled.div`
  display: flex;
  flex-direction: row;
  gap: 6px;
  overflow: hidden;
  width: ${({ width }) => width}px;
  height: ${({ height }) => height}px;
  min-width: ${({ width }) => width}px;
  min-height: ${({ height }) => height}px;
  position: relative;

  span {
    color: #fafafa;
    font-size: 12px;
  }

  .custom-checkbox {
    display: none;
  }

  .custom-checkbox-label {
    display: inline-block;
    width: 100%;
    height: 100%;
    background: transparent;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    cursor: pointer;
    position: relative;
    background-size: auto;
    background-position: center;
    background-repeat: no-repeat;
  }

  .custom-checkbox:checked + .custom-checkbox-label {
    ${({ checkedIconSrc }) =>
      checkedIconSrc &&
      `
      background-image: url(${checkedIconSrc});
    `}

    &::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #d3d3d3;
      font-size: ${({ width, height }) => Math.min(width, height) / 1.8}px;
      line-height: 1;
      pointer-events: none;
    }

    ${({ checkedIconSrc }) =>
      !checkedIconSrc &&
      `
      &::after {
        content: '✔';
      }
    `}
  }

  .custom-checkbox-label:active {
    /* Optional: Add active styles if desired */
    /* Example: filter: brightness(0.9); */
  }

  .custom-checkbox:disabled + .custom-checkbox-label {
    cursor: not-allowed;
    opacity: 0.6;
    /* Adjust background/border for disabled state if needed */
  }
`;
