import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import ColorDisplay from '../ColorDisplay/ColorDisplay.js';
import {
  updateRule,
  addColor,
  removeColor,
  toggleColor,
  removeRule,
} from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';
import { Trash2, ChevronDown, ChevronUp, PlusSquare, PlusCircle } from 'react-feather';

const { api } = window;

const HealingRule = ({ rule }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id)) || {};

  const [isOpen, setIsOpen] = useState(false);

  const handleColorPick = async () => {
    const colorData = await api.pickColor();
    if (colorData) {
      const { color, x, y } = colorData;
      dispatch(addColor({ id: healing.id, color, x, y }));
    }
  };

  const allFieldsFilled =
    healing.name && healing.key && healing.interval && healing.colors.length > 0;

  const handleRemoveRule = () => {
    dispatch(removeRule(healing.id));
  };

  return (
    <StyledDiv>
      <details open={isOpen} onToggle={() => setIsOpen(!isOpen)}>
        <summary>
          <div className="input-wrapper">
            <input
              className="input"
              id="name"
              value={healing.name}
              onChange={(event) => dispatch(updateRule({ ...healing, name: event.target.value }))}
              placeholder="Rule Name"
              disabled={healing.healing}
            />
            <label className="label" htmlFor="name">
              Name
            </label>
          </div>
          <div className="input-wrapper">
            <input
              className="input"
              id="key"
              value={healing.key}
              onChange={(event) => dispatch(updateRule({ ...healing, key: event.target.value }))}
              placeholder="F1"
              disabled={healing.healing}
            />
            <label className="label" htmlFor="key">
              Key
            </label>
          </div>
          <div className="input-wrapper">
            <input
              className="input"
              id="interval"
              value={healing.interval}
              onChange={(event) =>
                dispatch(updateRule({ ...healing, interval: event.target.value }))
              }
              placeholder="100"
              disabled={healing.healing}
            />
            <label className="label" htmlFor="interval">
              Interval (ms)
            </label>
          </div>
          <div className="input-wrapper input-wrapper-checkbox">
            <input
              className="input"
              id="enabled"
              type="checkbox"
              checked={!!healing.enabled}
              onChange={() => dispatch(updateRule({ ...healing, enabled: !healing.enabled }))}
              disabled={!allFieldsFilled}
            />
          </div>
          <button type="button" onClick={handleRemoveRule}>
            <Trash2 className="remove-rule-icon" size={28} />
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
              disabled={healing.healing}
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
                disabled={healing.healing}
              >
                <option value="true">Present</option>
                <option value="false">Absent</option>
              </select>
              <button
                className="button remove-color"
                type="button"
                onClick={() => dispatch(removeColor({ id: healing.id, colorId: color.id }))}
                disabled={healing.healing}
              >
                <Trash2 className="remove-color-icon" />
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
