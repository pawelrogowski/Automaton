import React from 'react';
import { Heart, Zap } from 'react-feather';
import StatBar from '../StatBar/StatBar.jsx';
import { StyledDiv } from './StatBars.styled.js';

export const StatBars = (props) => {
  return (
    <StyledDiv tooltip="Current healt and mana levels, if showing ?? please select/refresh tibia window with ctrl+w while tibia is focused">
      <div className="health-bar">
        <Heart size={16} className="hp-icon" />
        <StatBar value={props.hppc} fill={`#d10000`} />
      </div>

      <div className="mana-bar">
        <Zap size={16} className="mp-icon" />
        <StatBar value={props.mppc} fill={`#3800a1`} />
      </div>
    </StyledDiv>
  );
};
