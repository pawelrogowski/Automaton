import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import StyledTargeting from './Targeting.styled.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import TargetingTable from '../components/TargetingTable/TargetingTable.jsx';

const Targeting = () => {
  const { target } = useSelector((state) => state.targeting);

  return (
    <StyledTargeting>
      <HighWrapper title="Target Information">
        {target ? (
          <div className="target-info">
            <p>
              <strong>Name:</strong> {target.name}
            </p>
            <p>
              <strong>Distance:</strong> {target.distance}
            </p>
            <p>
              <strong>Game Coords:</strong> {target.gameCoordinates.x},{' '}
              {target.gameCoordinates.y}, {target.gameCoordinates.z}
            </p>
            <p>
              <strong>Absolute Coords:</strong> {target.absoluteCoordinates.x},{' '}
              {target.absoluteCoordinates.y}
            </p>
          </div>
        ) : (
          <p>No target selected</p>
        )}
      </HighWrapper>
      <TargetingTable />
    </StyledTargeting>
  );
};

export default Targeting;
