import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import StyledCavebot from './Cavebot.styled.js';
import Minimap from '../components/Minimap/Minimap.jsx';
import WaypointTable from '../components/WaypointTable/WaypointTable.jsx';
import ValueControl from '../components/NodeRangeControl/ValueControl.jsx';
import { setNodeRange } from '../redux/slices/cavebotSlice.js';

const Cavebot = () => {
  const dispatch = useDispatch();
  const nodeRange = useSelector((state) => state.cavebot.nodeRange);

  const handleNodeRangeChange = (newValue) => {
    dispatch(setNodeRange(newValue));
  };

  return (
    <StyledCavebot>
      <WaypointTable />
      <div className="minimap-controls-container">
        <div className="minimap-container">
          <Minimap />
        </div>
        <ValueControl
          label="Node Range"
          value={nodeRange}
          onChange={handleNodeRangeChange}
          min={1} // Assuming a minimum range of 1
          max={10} // Assuming a reasonable maximum range
        />
      </div>
    </StyledCavebot>
  );
};

export default Cavebot;
