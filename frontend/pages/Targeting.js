import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setStance, setDistance } from '../redux/slices/targetingSlice.js';
import StyledTargeting from './Targeting.styled.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import CustomSelect from '../components/CustomSelect/CustomSelect.js';

const Targeting = () => {
  const dispatch = useDispatch();
  const { stance, distance, creatures } = useSelector(
    (state) => state.targeting,
  );

  const handleStanceChange = (e) => {
    dispatch(setStance(e.target.value));
  };

  const handleDistanceChange = (e) => {
    dispatch(setDistance(parseInt(e.target.value, 10)));
  };

  const stanceOptions = [
    { value: 'Ignore', label: 'Ignore' },
    { value: 'keepAway', label: 'Keep Away' },
    { value: 'waitAndKeepAway', label: 'Wait and Keep Away' },
    { value: 'Reach', label: 'Reach' },
    { value: 'Stand', label: 'Stand' },
  ];

  return (
    <StyledTargeting>
      <HighWrapper title="Targeting Settings">
        <div className="settings-container">
          <div className="setting-row">
            <label htmlFor="stance-select">Stance:</label>
            <CustomSelect
              id="stance-select"
              value={stance}
              onChange={handleStanceChange}
              options={stanceOptions}
            />
          </div>
          <div className="setting-row">
            <label htmlFor="distance-input">Distance:</label>
            <input
              id="distance-input"
              type="number"
              value={distance}
              onChange={handleDistanceChange}
              min="1"
            />
          </div>
        </div>
      </HighWrapper>
      <HighWrapper title="Creatures on Screen">
        <div className="creatures-list">
          <ul>
            {creatures.map((creature, index) => (
              <li key={index}>
                X: {creature.gameCoords.x}, Y: {creature.gameCoords.y}, Z:{' '}
                {creature.gameCoords.z}
              </li>
            ))}
          </ul>
        </div>
      </HighWrapper>
    </StyledTargeting>
  );
};

export default Targeting;
