import React, { useState } from 'react';
import PropTypes from 'prop-types';
import ColorDisplay from '../ColorDisplay/ColorDisplay.js';

const { api } = window;

const HealingRule = ({ rule, onRuleChange }) => {
  const [name, setName] = useState(rule.name);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [key, setKey] = useState(rule.key);
  const [interval, setInterval] = useState(rule.interval);
  const [color, setColor] = useState(null);

  const handleColorPick = async () => {
    const pickedColor = await api.pickColor();
    setColor(pickedColor);
    onRuleChange({ ...rule, color });
  };

  return (
    <div>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <button type="button" onClick={handleColorPick}>
        Pick Pixel
      </button>
      <ColorDisplay color={color} />
      <input value={key} onChange={(e) => setKey(e.target.value)} />
      <input value={interval} onChange={(e) => setInterval(e.target.value)} />
    </div>
  );
};

HealingRule.propTypes = {
  rule: PropTypes.shape({
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    interval: PropTypes.string,
  }).isRequired,
  onRuleChange: PropTypes.func.isRequired,
};

export default HealingRule;
