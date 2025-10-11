import React from 'react';
import {
  SwitchWrapper,
  SwitchLabel,
  SwitchContainer,
  HiddenCheckbox,
  StyledSwitch,
  SwitchThumb,
} from './CustomSwitch.styled.js'; // Import new wrapper and label

const CustomSwitch = ({ checked, onChange, label, ...props }) => {
  // Add label prop
  return (
    <SwitchWrapper {...props}>
      {' '}
      {/* Use the new wrapper */}
      {label && <SwitchLabel>{label}</SwitchLabel>}{' '}
      {/* Conditionally render label */}
      <SwitchContainer>
        {' '}
        {/* Keep SwitchContainer wrapping interactive elements */}
        <HiddenCheckbox type="checkbox" checked={checked} onChange={onChange} />
        <StyledSwitch>
          <SwitchThumb checked={checked} />
        </StyledSwitch>
      </SwitchContainer>
    </SwitchWrapper>
  );
};

export default CustomSwitch;
