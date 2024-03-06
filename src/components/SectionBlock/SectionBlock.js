import React from 'react';
import PropTypes from 'prop-types';
import { StyledSection } from './SectionBlock.styled';

const SectionBlock = ({ children }) => {
  return <StyledSection>{children}</StyledSection>;
};

SectionBlock.propTypes = {
  children: PropTypes.node.isRequired,
};

export default SectionBlock;
