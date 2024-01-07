import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import Switch from 'react-switch';
import { Trash2, ChevronDown, ChevronUp, PlusCircle } from 'react-feather';
import _ from 'lodash';

import ColorDisplay from '../ColorDisplay/ColorDisplay.js';
import {
  updateRule,
  addColor,
  removeColor,
  toggleColor,
  removeRule,
} from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';

const { api } = window;
const keys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].map(
  (key) => ({ value: key, label: key }),
);

const HealingRule = ({ rule }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id)) || {};

  const [isOpen, setIsOpen] = useState(false);
  const [localHealing, setLocalHealing] = useState(healing);

  useEffect(() => {
    const debouncedUpdate = _.debounce(() => {
      dispatch(updateRule(localHealing));
    }, 500);
    debouncedUpdate();
    // Cleanup function to cancel the debounce on unmount
    return debouncedUpdate.cancel;
  }, [localHealing, dispatch]);

  const handleColorPick = async () => {
    const colorData = await api.pickColor();
    if (colorData) {
      const { color, x, y } = colorData;
      dispatch(addColor({ id: healing.id, color, x, y }));
    }
  };

  const requiredFieldsFilled =
    healing.name &&
    healing.key &&
    healing.interval &&
    healing.hpTriggerCondition &&
    healing.hpTriggerPercentage &&
    healing.manaTriggerCondition &&
    healing.manaTriggerPercentage;

  const handleRemoveRule = () => {
    dispatch(removeRule(healing.id));
  };

  return (
    <StyledDiv $running={healing.enabled}>
      <details open={isOpen} onToggle={() => setIsOpen(!isOpen)}>
        <summary>
          <div className="input-wrapper input-wrapper-checkbox">
            <Switch
              checked={healing.enabled}
              onChange={() =>
                setLocalHealing({
                  ...localHealing,
                  enabled: !localHealing.enabled,
                  colors: healing.colors,
                })
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
              className="input input-key"
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
              {keys.map((key) => (
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
              className="input"
              id="interval"
              value={localHealing.interval}
              onChange={(event) => {
                if (event.target.value !== undefined) {
                  setLocalHealing({
                    ...localHealing,
                    interval: event.target.value,
                    colors: healing.colors,
                  });
                }
              }}
              placeholder="100 ms"
              min={10}
              max={9999999}
              step={100}
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="interval">
              Refresh
            </label>
          </div>
          <button
            className="remove-rule-button"
            type="button"
            onClick={handleRemoveRule}
            disabled={healing.enabled}
            aria-label="remove-rule"
          >
            <Trash2 className="remove-rule-icon" size={24} />
          </button>
          {isOpen ? (
            <ChevronUp className="details-arrow" />
          ) : (
            <ChevronDown className="details-arrow" />
          )}
        </summary>
        <div className="details-wrapper">
          <div className="conditions-header-wrapper">
            <h2 className="conditions-header">Color Conditions</h2>
            <button
              className="button pick-pixel-button"
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
                className="button remove-color"
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
    interval: PropTypes.string,
    colors: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        color: PropTypes.string,
        enabled: PropTypes.bool,
      }),
    ),
  }).isRequired,
};

export default HealingRule;
