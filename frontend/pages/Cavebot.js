import React from 'react';
import StyledCavebot from './Cavebot.styled.js';
import Minimap from '../components/Minimap/Minimap.jsx';

const Cavebot = () => {
  return (
    <StyledCavebot>
      <div className="minimap-container">
        <Minimap />
      </div>
    </StyledCavebot>
  );
};

export default Cavebot;
