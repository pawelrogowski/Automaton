import React from 'react';
import PropTypes from 'prop-types';
import { StyledButton } from './PresetButton.styled';

export const PresetButton = ({ className, onMouseDown, children, active }) => {
  return (
    <StyledButton
      className={className}
      type="button"
      onMouseDown={onMouseDown}
      active={active}
      tooltip="Switch rule preset (alt+1-5), (shift+left click) on another preset button to copy other preset into current one"
    >
      {children}
    </StyledButton>
  );
};

PresetButton.propTypes = {
  className: PropTypes.string,
  onMouseDown: PropTypes.func.isRequired,
  text: PropTypes.string.isRequired,
};
