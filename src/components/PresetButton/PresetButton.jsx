import React from 'react';
import PropTypes from 'prop-types';
import { StyledButton } from './PresetButton.styled';

export const PresetButton = ({ className, onMouseDown, children, active }) => {
  return (
    <StyledButton className={className} type="button" onMouseDown={onMouseDown} active={active}>
      {children}
    </StyledButton>
  );
};

PresetButton.propTypes = {
  className: PropTypes.string,
  onMouseDown: PropTypes.func.isRequired,
  text: PropTypes.string.isRequired,
};
