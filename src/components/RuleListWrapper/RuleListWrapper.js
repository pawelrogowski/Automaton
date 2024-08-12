import React from 'react';
import { StyledDiv } from './RuleListWrapper.styled.js';

const RuleListWrapper = ({ children }) => {
  return (
    <StyledDiv>
      <div className="header">
        <div className="header-item header-item_1">•</div>
        <div className="header-item header-item_2">Name</div>
        <div className="header-item header-item_3">CD Group</div>
        <div className="header-item header-item_4">HK</div>
        <div className="header-item header-item_5">Health %</div>
        <div className="header-item header-item_6">Mana %</div>
        <div className="header-item header-item_6">Monster#</div>
        <div className="header-item header-item_7">Priority</div>
        <div className="header-item header-item_8">CustomCD</div>
        <div className="header-item header-placeholder">-</div>
      </div>
      <div className="rules">{children}</div>
    </StyledDiv>
  );
};

export default RuleListWrapper;
