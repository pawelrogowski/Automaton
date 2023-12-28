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
import { Trash2, ChevronDown, ChevronUp } from 'react-feather';

const { api } = window;

const HealingRule = ({ rule }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id));

  const [isOpen, setIsOpen] = useState(false);

  const handleColorPick = async () => {
    const pickedColor = await api.pickColor();
    dispatch(addColor({ id: healing.id, color: pickedColor }));
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
              className="input input-checkbox"
              id="enabled"
              type="checkbox"
              checked={healing.healing}
              onChange={() => dispatch(updateRule({ ...healing, healing: !healing.healing }))}
              disabled={!allFieldsFilled}
            />
          </div>
          <button type="button" onClick={handleRemoveRule}>
            <Trash2 size={28} />
          </button>
          {isOpen ? (
            <ChevronUp className="details-arrow" />
          ) : (
            <ChevronDown className="details-arrow" />
          )}
        </summary>
        <button
          className="button"
          type="button"
          onClick={handleColorPick}
          disabled={healing.healing}
        >
          Pick Pixel
        </button>
        {healing.colors.map((color) => (
          <div key={color.id}>
            <ColorDisplay color={color.color} />
            <select
              className="input"
              value={color.enabled}
              onChange={() => dispatch(toggleColor({ id: healing.id, color: color.color }))}
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
            <button
              className="button"
              type="button"
              onClick={() => dispatch(removeColor({ id: healing.id, colorId: color.id }))}
            >
              Remove Color
            </button>
          </div>
        ))}
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
