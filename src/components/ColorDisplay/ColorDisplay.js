import React from 'react';
import PropTypes from 'prop-types';
import StyledDiv from './ColorDisplay.styled.js';

const ColorDisplay = ({ color }) => <StyledDiv style={{ backgroundColor: color }} />;

ColorDisplay.propTypes = {
  color: PropTypes.string,
};

ColorDisplay.defaultProps = {
  color: '#000000',
};

export default ColorDisplay;
