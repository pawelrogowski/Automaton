import React from 'react';
import { StyledDiv } from './Misc.styled.js';
import HealFriendControls from '../components/HealFriendController/HealFriendController.js';
import ManaSyncController from '../components/ManaSyncController/ManaSyncController.js';

export const Misc = () => (
  <StyledDiv className="controllers-wrapper">
    <HealFriendControls />
    <ManaSyncController />
  </StyledDiv>
);

export default Misc;
