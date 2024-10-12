import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateManaSync, toggleManaSyncEnabled } from '../../redux/slices/healingSlice.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import keyboardKeys from '../../constants/keyboardKeys.js';
import SunkenWrapper from '../SunkenWrapper/SunkenWrapper.js';
import { ManaSync } from './ManaSyncController.styled.js';
import HighWrapper from '../HighWrapper/HighWrapper.js';

const ManaSyncController = () => {
  const dispatch = useDispatch();
  const manaSyncRule = useSelector((state) =>
    state.healing.presets[state.healing.activePresetIndex].find((rule) => rule.id === 'manaSync'),
  );

  const handleManaSyncToggle = () => {
    dispatch(toggleManaSyncEnabled());
  };

  const handleManaSyncKeyChange = (event) => {
    dispatch(
      updateManaSync({
        ...manaSyncRule,
        key: event.target.value,
      }),
    );
  };

  const handleManaTriggerPercentageChange = (event) => {
    dispatch(
      updateManaSync({
        ...manaSyncRule,
        manaTriggerPercentage: Number(event.target.value),
      }),
    );
  };

  return (
    <ManaSync>
      <HighWrapper className="heal-friend-wrapper" title="Mana Sync">
        <div className="heal-friend-header">
          <CustomCheckbox
            checked={manaSyncRule.enabled}
            onChange={handleManaSyncToggle}
            size={18}
          />
          <h5 className="">Enabled</h5>
        </div>

        <div className="">
          <SunkenWrapper title="Hotkey">
            <ListSelect
              className=""
              id="manaSyncKey"
              value={manaSyncRule.key || 'F12'}
              defaultValue="F12"
              onChange={handleManaSyncKeyChange}
              placeholder="F12"
            >
              {keyboardKeys.map((key) => (
                <option key={key.value} value={key.value}>
                  {key.label}
                </option>
              ))}
            </ListSelect>
          </SunkenWrapper>
        </div>
        <div className="">
          <SunkenWrapper title="Mana %">
            <ListInput
              type="number"
              className=""
              id="manaSyncManaPercentage"
              value={manaSyncRule.manaTriggerPercentage}
              onChange={handleManaTriggerPercentageChange}
              defaultValue="90"
              placeholder="90"
              min="1"
              max="100"
            />
          </SunkenWrapper>
        </div>
      </HighWrapper>
    </ManaSync>
  );
};

export default ManaSyncController;
