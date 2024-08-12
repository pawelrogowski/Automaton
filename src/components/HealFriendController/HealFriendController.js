import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateHealFriend, toggleHealFriendEnabled } from '../../redux/slices/healingSlice.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import keyboardKeys from '../../constants/keyboardKeys.js';
import SunkenWrapper from '../SunkenWrapper/SunkenWrapper.js';
import { HealFriend } from './HealFriendController.styled.js';
import HighWrapper from '../HighWrapper/HighWrapper.js';

const HealFriendControls = () => {
  const dispatch = useDispatch();
  const healFriendRule = useSelector((state) =>
    state.healing.presets[state.healing.activePresetIndex].find((rule) => rule.id === 'healFriend'),
  );

  const handleHealFriendToggle = () => {
    dispatch(toggleHealFriendEnabled());
  };

  const handleHealFriendKeyChange = (event) => {
    dispatch(
      updateHealFriend({
        ...healFriendRule,
        key: event.target.value,
      }),
    );
  };

  const handleManaTriggerPercentageChange = (event) => {
    dispatch(
      updateHealFriend({
        ...healFriendRule,
        manaTriggerPercentage: Number(event.target.value),
      }),
    );
  };

  const handleFriendHpTriggerPercentageChange = (event) => {
    dispatch(
      updateHealFriend({
        ...healFriendRule,
        friendHpTriggerPercentage: Number(event.target.value),
      }),
    );
  };
  return (
    <HealFriend>
      <HighWrapper className="heal-friend-wrapper" title="Heal Friend">
        <div className="heal-friend-header">
          <CustomCheckbox
            checked={healFriendRule.enabled}
            onChange={handleHealFriendToggle}
            size={18}
          />
          <h5 className="">Enabled</h5>
        </div>
        <div className="heal-friend-header">
          <CustomCheckbox
            checked={healFriendRule.enabled}
            onChange={handleHealFriendToggle}
            size={18}
          />
          <h5 className="">use UH</h5>
        </div>

        <div className="">
          <SunkenWrapper title="Hotkey">
            <ListSelect
              className=""
              id="healFriendKey"
              value={healFriendRule.key || 'F1'}
              defaultValue={'F1'}
              onChange={handleHealFriendKeyChange}
              placeholder="F1"
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
          <SunkenWrapper title="Health %">
            <ListInput
              type="number"
              className=""
              id="friendHpPercentage"
              value={healFriendRule.friendHpTriggerPercentage}
              onChange={handleFriendHpTriggerPercentageChange}
              defaultValue={70}
              placeholder="70"
              min="1"
              max="100"
            />
          </SunkenWrapper>
        </div>
      </HighWrapper>
    </HealFriend>
  );
};

export default HealFriendControls;
