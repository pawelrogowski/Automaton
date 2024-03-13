// CustomCheckbox.js
import React from 'react';
import { TibiaCheckbox } from './CustomCheckbox.styled.js';
const CustomCheckbox = ({ checked, onChange, disabled }) => {
  const uniqueId = `custom-checkbox-${Math.random().toString(36).substr(2, 9)}`;
  return (
    <TibiaCheckbox>
      <input
        type="checkbox"
        id={uniqueId}
        className="custom-checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <label htmlFor={uniqueId} className="custom-checkbox-label"></label>
    </TibiaCheckbox>
  );
};

export default CustomCheckbox;
