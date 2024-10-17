import React from 'react';
import { TibiaCheckbox } from './CustomCheckbox.styled.js';

const CustomCheckbox = ({ checked, onChange, disabled, width = 22, height = 22 }) => {
  const uniqueId = `custom-checkbox-${Math.random().toString(36).substr(2, 9)}`;
  return (
    <TibiaCheckbox width={width} height={height}>
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
