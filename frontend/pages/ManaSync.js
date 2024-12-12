import React from 'react';
import { StyledDiv } from './ManaSync.styled.js';
import HealFriendControls from '../components/HealFriendController/HealFriendController.js';
import ManaSyncController from '../components/ManaSyncController/ManaSyncController.js';

export const ManaSync = () => (
  <StyledDiv className="controllers-wrapper">
    <ManaSyncController />
  </StyledDiv>
);

export default ManaSync;
