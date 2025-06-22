import React from 'react';
import StyledCavebot from './Cavebot.styled.js';
import Minimap from '../components/Minimap/Minimap.jsx';
import WaypointTable from '../components/WaypointTable/WaypointTable.jsx';

const Cavebot = () => {
  return (
    <StyledCavebot>
      <WaypointTable />
      <div className="minimap-container">
        <Minimap />
      </div>
    </StyledCavebot>
  );
};

export default Cavebot;
