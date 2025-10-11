import styled from 'styled-components';

// New wrapper to contain label (absolute) and switch (normal flow)
export const SwitchWrapper = styled.div`
  position: relative; // Provide positioning context for absolute children
  display: flex;
`;

// New component for the label text
export const SwitchLabel = styled.div`
  position: absolute; // Position absolutely relative to SwitchWrapper
  top: 0; // Position at the top of the wrapper
  left: 50%; // Start at the horizontal center of the wrapper
  transform: translateX(-50%); // Shift back by half its width to truly center
  font-size: 9px;
  color: #fafafa;
  text-align: center;
  white-space: nowrap; // Prevent text wrapping
`;

export const SwitchContainer = styled.label`
  display: inline-block;
  cursor: pointer;
  user-select: none;
`;

export const HiddenCheckbox = styled.input.attrs({ type: 'checkbox' })`
  border: 0;
  clip: rect(0 0 0 0);
  clippath: inset(50%);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
`;

export const StyledSwitch = styled.div`
  position: relative;
  width: 48px; // Increased width for better glassmorphism feel
  height: 24px; // Increased height
  background: rgb(36, 36, 36);
  border-radius: 12px;
  transition: all 0.2s ease-in-out;
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
`;

export const SwitchThumb = styled.div`
  position: absolute;
  top: 1px;
  left: 1px;
  width: 20px;
  height: 20px;
  background: ${({ checked }) =>
    checked
      ? 'rgb(183, 0, 255);'
      : 'rgb(103, 103, 103);'}; // Green when checked, grey when unchecked
  border-radius: 50%; // Circle shape
  transition: all 0.2s ease-in-out;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  ${({ checked }) =>
    checked &&
    `
    transform: translateX(24px); // Move thumb when checked (48px width - 20px thumb - 2*1px border - 2*1px spacing)
  `}
`;
