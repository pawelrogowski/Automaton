import React from 'react';
import PropTypes from 'prop-types';

const ColorDisplay = ({ color }) => (
  <div style={{ backgroundColor: color, width: '100px', height: '100px' }} />
);

ColorDisplay.propTypes = {
  color: PropTypes.string,
};

ColorDisplay.defaultProps = {
  color: '#000000',
};

export default ColorDisplay;
