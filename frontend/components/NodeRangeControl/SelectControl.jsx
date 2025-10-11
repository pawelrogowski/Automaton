import React from 'react';
import {
  StyledValueControl,
  ControlLabel,
  ControlInput,
} from './ValueControl.styled.js';

const SelectControl = ({ label, value, onChange, options }) => {
  const handleChange = (e) => {
    const newValue =
      e.target.value === 'true'
        ? true
        : e.target.value === 'false'
          ? false
          : e.target.value;
    onChange(newValue);
  };

  return (
    <StyledValueControl>
      <ControlLabel>{label}</ControlLabel>
      <ControlInput as="select" value={value} onChange={handleChange}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </ControlInput>
    </StyledValueControl>
  );
};

export default SelectControl;
