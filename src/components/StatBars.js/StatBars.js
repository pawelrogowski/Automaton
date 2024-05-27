import React from 'react';
import { Heart, Zap } from 'react-feather';
import StatBar from '../StatBar/StatBar.jsx';
import { StyledDiv } from './StatBars.styled.js';

export function StatBars(props) {
  return (
    <StyledDiv>
      <div className="health-bar">
        <StatBar value={props.hpPercentage} fill={`#d10000`} />
        <Heart size={16} className="hp-icon" />
      </div>

      <div className="mana-bar">
        <StatBar value={props.manaPercentage} fill={`#3800a1`} />
        <Zap size={16} className="mp-icon" />
      </div>
    </StyledDiv>
  );
}
