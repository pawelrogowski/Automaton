import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';
import Switch from 'react-switch';
import { Trash2, ChevronDown, ChevronUp, PlusCircle } from 'react-feather';
import InputMask from 'react-input-mask';
import Select from 'react-select';

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
const keys = [
  'Return',
  'Enter',
  'Escape',
  'BackSpace',
  'Tab',
  'Space',
  'Delete',
  'Home',
  'End',
  'Left',
  'Up',
  'Right',
  'Down',
  'Page_Up',
  'Page_Down',
  'Shift_L',
  'Shift_R',
  'Control_L',
  'Control_R',
  'Alt_L',
  'Alt_R',
  'Meta_L',
  'Meta_R',
  'Super_L',
  'Super_R',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
].map((key) => ({ value: key, label: key }));

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
    <StyledDiv $running={healing.enabled}>
      <details open={isOpen} onToggle={() => setIsOpen(!isOpen)}>
        <summary>
          <div className="input-wrapper input-wrapper-checkbox">
            <Switch
              checked={healing.enabled}
              onChange={() => dispatch(updateRule({ ...healing, enabled: !healing.enabled }))}
              disabled={!allFieldsFilled}
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
              value={healing.name}
              onChange={(event) => dispatch(updateRule({ ...healing, name: event.target.value }))}
              placeholder="Rule Name"
              disabled={healing.enabled}
            />
            <label className="label" htmlFor="name">
              Name
            </label>
          </div>
          <div className="input-wrapper">
            <select
              className="input input-key"
              id="key"
              value={healing.key}
              onChange={(event) => dispatch(updateRule({ ...healing, key: event.target.value }))}
              disabled={healing.enabled}
            >
              {keys.map((key) => (
                <option key={key.value} value={key.value}>
                  {key.label}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="key">
              Key
            </label>
          </div>
          <div className="input-wrapper">
            <InputMask
              className="input"
              id="interval"
              value={healing.interval}
              onChange={(event) =>
                dispatch(updateRule({ ...healing, interval: event.target.value }))
              }
              placeholder="100"
              disabled={healing.enabled}
              mask="999999"
            />
            <label className="label" htmlFor="interval">
              Interval (ms)
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
