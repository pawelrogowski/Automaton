import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import Switch from 'react-switch';
import { Trash2, PlusCircle } from 'react-feather';
import ColorDisplay from '../ColorDisplay/ColorDisplay.js';
import keyboardKeys from '../../constants/keyboardKeys.js';

import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import {
  updateRule,
  addColor,
  removeColor,
  toggleColor,
  removeRule,
  updateCondition,
} from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';

const { api } = window;

const HealingRule = ({ rule }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id)) || {};
  const [localHealing, setLocalHealing] = useState(healing);
  const [isOpen, setIsOpen] = useState(false);
  const [characterStatusValue, setCharacterStatusValue] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [statusConditions, setStatusConditions] = useState({});

  useEffect(() => {
    dispatch(updateRule(localHealing));
  }, [localHealing]);

  const handleColorPick = async () => {
    const colorData = await api.pickColor();
    if (colorData) {
      const { color, x, y } = colorData;
      dispatch(addColor({ id: healing.id, color, x, y }));
    }
  };

  const handleStatusConditionChange = (status, value) => {
    setStatusConditions((prevState) => ({
      ...prevState,
      [status]: value,
    }));
    dispatch(updateCondition({ id: healing.id, condition: status, value }));
  };

  const handleRemoveRule = () => {
    dispatch(removeRule(healing.id));
  };

  const requiredFieldsFilled =
    healing.name &&
    healing.key &&
    healing.hpTriggerCondition &&
    healing.hpTriggerPercentage &&
    healing.manaTriggerCondition &&
    healing.manaTriggerPercentage &&
    healing.priority &&
    healing.category;

  return (
    <StyledDiv $running={healing.enabled}>
      <details open={isOpen} onToggle={() => setIsOpen(!isOpen)}>
        {/* ////////////////////////////////////////////////////////////////////////////////// */}
        <div className="input-wrapper">
          <CharacterStatusConditions
            ruleId={rule.id} // Pass the ruleId to the CharacterStatusConditions component
            onStatusConditionChange={handleStatusConditionChange} // Define the callback if needed
          />
        </div>
        <summary>
          <div className="input-wrapper input-wrapper-checkbox">
            <Switch
              checked={healing.enabled}
              onChange={() =>
                setLocalHealing((prevLocalHealing) => ({
                  ...prevLocalHealing,
                  enabled: !prevLocalHealing.enabled,
                  colors: healing.colors,
                  conditions: prevLocalHealing.conditions, // Preserve the conditions
                }))
              }
              disabled={!requiredFieldsFilled}
              offColor="#ff1c1c"
              onColor="#00ff00"
              handleDiameter={26}
              uncheckedIcon={false}
              checkedIcon={false}
              boxShadow="0px 1px 5px rgba(0, 0, 0, 0.6)"
              activeBoxShadow="0px 0px 1px 10px rgba(0, 0, 0, 0.2)"
              height={18}
              width={48}
              className="react-switch"
            />
          </div>
          <div className="input-wrapper">
            <input
              className="input"
              id="name"
              value={localHealing.name}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  name: event.target.value,
                  colors: healing.colors,
                })
              }
              placeholder="Rule Name"
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="name">
              Rule Name
            </label>
          </div>
          <div className="input-wrapper">
            <select
              className="input input-category"
              id="category"
              value={localHealing.category}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  category: event.target.value,
                })
              }
              disabled={healing.enabled}
            >
              <option value="Healing">Healing</option>
              <option value="Potions">Potions</option>
              <option value="Support">Support</option>
              <option value="Attack">Attack</option>
              <option value="Equip">Equip</option>
            </select>
            <label className="label" htmlFor="category">
              Category
            </label>
          </div>
          <div className="input-wrapper">
            <select
              className="input input-hotkey"
              id="key"
              value={localHealing.key}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  key: event.target.value,
                  colors: healing.colors,
                })
              }
              placeholder="F1"
              disabled={healing.enabled}
            >
              {keyboardKeys.map((key) => (
                <option key={key.value} value={key.value}>
                  {key.label}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="key">
              Hotkey
            </label>
          </div>
          <div className="input-wrapper">
            <select
              className="input input-percent-select"
              id="hpTriggerCondition"
              value={localHealing.hpTriggerCondition}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  hpTriggerCondition: event.target.value,
                  colors: healing.colors,
                })
              }
              disabled={healing.enabled}
            >
              <option value="<=">{'<='}</option>
              <option value="<">{'<'}</option>
              <option value="=">=</option>
              <option value=">">{'>'}</option>
              <option value=">=">{'>='}</option>
              <option value="!=">!=</option>
            </select>
            <input
              className="input input-percent"
              type="number"
              min="1"
              max="100"
              step="1"
              id="hpTriggerPercentage"
              value={localHealing.hpTriggerPercentage}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  hpTriggerPercentage: event.target.value,
                  colors: healing.colors,
                })
              }
              placeholder="0"
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="hpTriggerPercentage">
              Health %
            </label>
          </div>
          <div className="input-wrapper">
            <select
              className="input input-percent-select"
              id="manaTriggerCondition"
              value={localHealing.manaTriggerCondition}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  manaTriggerCondition: event.target.value,
                  colors: healing.colors,
                })
              }
              disabled={healing.enabled}
            >
              <option value="<=">{'<='}</option>
              <option value="<">{'<'}</option>
              <option value="=">=</option>
              <option value=">">{'>'}</option>
              <option value=">=">{'>='}</option>
              <option value="!=">!=</option>
            </select>
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              className="input input-percent"
              id="manaTriggerPercentage"
              value={localHealing.manaTriggerPercentage}
              onChange={(event) => {
                if (event.target.value !== undefined) {
                  setLocalHealing({
                    ...localHealing,
                    manaTriggerPercentage: event.target.value,
                    colors: healing.colors,
                  });
                }
              }}
              placeholder="0"
              disabled={healing.enabled}
            />
            <label className="label label-percent" htmlFor="manaTriggerPercentage">
              Mana %
            </label>
          </div>
          <div className="input-wrapper">
            <input
              type="number"
              className="input input-priority"
              id="priority"
              value={localHealing.priority}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  priority: event.target.value,
                  colors: healing.colors,
                })
              }
              min="0"
              max="99"
              placeholder="Priority"
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="priority">
              Priority
            </label>
          </div>
          <div className="input-wrapper">
            <input
              type="number"
              className="input input-delay"
              id="delay"
              value={localHealing.delay}
              onChange={(event) =>
                setLocalHealing({
                  ...localHealing,
                  delay: event.target.value,
                })
              }
              placeholder="25"
              min="25"
              step="25"
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="delay">
              Delay (ms)
            </label>
          </div>

          <button
            className="remove-rule-button rule-button"
            type="button"
            onClick={handleRemoveRule}
            disabled={healing.enabled}
            aria-label="remove-rule"
          >
            Remove
          </button>
          {isOpen ? (
            <button type="button" className="rule-button button-expand">
              Expand
            </button>
          ) : (
            <button type="button" className="rule-button button-expand">
              Expand
            </button>
          )}
        </summary>
        <div className="details-wrapper">
          <div className="conditions-header-wrapper">
            <h2 className="conditions-header">Color Conditions</h2>
            <button
              className="rule-button pick-pixel-button"
              type="button"
              onClick={handleColorPick}
              disabled={healing.enabled}
            >
              <PlusCircle size={24} />
            </button>
          </div>
          {healing.colors.map((color) => (
            <div className="picked-color-wrapper" key={color.id}>
              <ColorDisplay color={color.color} />

              <ul className="coordinate-list">
                <li>X: {color.x || 0}</li>
                <li>Y: {color.y || 0}</li>
              </ul>

              <select
                className="input"
                value={color.enabled}
                onChange={() => dispatch(toggleColor({ id: healing.id, colorId: color.id }))}
                disabled={healing.enabled}
              >
                <option value="true">Present</option>
                <option value="false">Absent</option>
              </select>
              <button
                className="rule-button remove-color"
                type="button"
                onClick={() => dispatch(removeColor({ id: healing.id, colorId: color.id }))}
                disabled={healing.enabled}
              >
                <Trash2 className="remove-color-icon" size={20} />
              </button>
            </div>
          ))}
        </div>
      </details>
    </StyledDiv>
  );
};

HealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    colors: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        color: PropTypes.string,
        enabled: PropTypes.bool,
      }),
    ),
    // eslint-disable-next-line react/forbid-prop-types
    conditions: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
};

export default HealingRule;
