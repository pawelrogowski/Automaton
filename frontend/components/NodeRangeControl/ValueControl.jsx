import React from 'react';
import {
  StyledValueControl,
  ControlLabel,
  ControlInput,
} from './ValueControl.styled.js';

const ValueControl = ({ label, value, onChange, min = 0, max = 100 }) => {
  const handleChange = (e) => {
    const newValue = parseInt(e.target.value, 10);
    if (!isNaN(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <StyledValueControl>
      <ControlLabel>{label}</ControlLabel>
      <ControlInput
        type="number"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
      />
    </StyledValueControl>
  );
};

export default ValueControl;
