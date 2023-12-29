import React from 'react';
import PropTypes from 'prop-types';
import StyledDiv from './ColorDisplay.styled.js';

const ColorDisplay = ({ color }) => (
  <StyledDiv style={{ backgroundColor: color }}>
    <span>{color}</span>
  </StyledDiv>
);

ColorDisplay.propTypes = {
  color: PropTypes.string,
};

ColorDisplay.defaultProps = {
  color: '#000000',
};

export default ColorDisplay;
