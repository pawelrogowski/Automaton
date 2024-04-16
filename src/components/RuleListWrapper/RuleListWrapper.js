import React from 'react';
import { StyledDiv } from './RuleListWrapper.styled.js';

const RuleListWrapper = ({ children }) => {
  return (
    <StyledDiv>
      <div className="header">
        <div className="header-item header-item_1">•</div>
        <div className="header-item header-item_2">Name</div>
        <div className="header-item header-item_3">Category</div>
        <div className="header-item header-item_4">Hotkey</div>
        <div className="header-item header-item_5">Health %</div>
        <div className="header-item header-item_6">Mana %</div>
        <div className="header-item header-item_7">Priority</div>
        <div className="header-item header-item_8">Interval</div>
      </div>
      {children}
    </StyledDiv>
  );
};

export default RuleListWrapper;
