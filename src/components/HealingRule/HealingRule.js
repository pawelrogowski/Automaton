import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import debounce from 'lodash/debounce.js';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { updateRule, removeRule, updateCondition } from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';

const HealingRule = ({ rule, className }) => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const healing =
    useSelector((state) =>
      state.healing.presets[activePresetIndex].find((r) => r.id === rule.id),
    ) || {};
  const [isOpen, setIsOpen] = useState(false);

  const [statusConditions, setStatusConditions] = useState({});

  // Local state for numeric inputs
  const [localInputs, setLocalInputs] = useState({
    hpTriggerPercentage: healing.hpTriggerPercentage,
    manaTriggerPercentage: healing.manaTriggerPercentage,
    monsterNum: healing.monsterNum,
    priority: healing.priority,
    delay: healing.delay,
  });

  // Debounced function to update Redux
  const debouncedUpdate = useCallback(
    debounce((field, value) => {
      const updatedField = { [field]: value };
      dispatch(updateRule({ id: healing.id, ...updatedField }));
    }, 1000),
    [dispatch, healing.id],
  );

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

  const handleUpdateRule = (updatedFields) => {
    const fieldsToUpdate = { ...updatedFields };
    if (!('category' in fieldsToUpdate)) {
      fieldsToUpdate.category = healing.category;
    }
    dispatch(updateRule({ id: healing.id, ...fieldsToUpdate }));
  };

  // Generic handler for numeric inputs
  const handleNumericInputChange = (field, min, max) => (event) => {
    const value = parseInt(event.target.value, 10);
    setLocalInputs((prev) => ({ ...prev, [field]: value }));
    debouncedUpdate(field, Math.max(min, Math.min(max, value)));
  };

  // Generic handler for numeric input blur events
  const handleNumericInputBlur = (field, min, max) => () => {
    const value = localInputs[field];
    const validValue = Math.max(min, Math.min(max, value));
    setLocalInputs((prev) => ({ ...prev, [field]: validValue }));
    if (validValue !== healing[field]) {
      dispatch(updateRule({ id: healing.id, [field]: validValue }));
    }
  };

  // Sync local state with Redux state
  useEffect(() => {
    setLocalInputs({
      hpTriggerPercentage: healing.hpTriggerPercentage,
      manaTriggerPercentage: healing.manaTriggerPercentage,
      monsterNum: healing.monsterNum,
      priority: healing.priority,
      delay: healing.delay,
    });
  }, [healing]);

  return (
    <StyledDiv className={className} $running={healing.enabled}>
      <details open={isOpen} onToggle={() => setIsOpen(!isOpen)}>
        <CharacterStatusConditions
          ruleId={rule.id}
          onStatusConditionChange={handleStatusConditionChange}
        />
        <summary>
          <CustomCheckbox
            checked={healing.enabled}
            onChange={() => handleUpdateRule({ enabled: !healing.enabled })}
            size={22}
          />
          <ListInput
            className="input"
            id="name"
            value={healing.name}
            onChange={(event) => handleUpdateRule({ name: event.target.value })}
            placeholder="Rule Name"
          />
          <ListSelect
            className="input input-category select-with-arrow"
            id="category"
            value={healing.category}
            onChange={(event) => handleUpdateRule({ category: event.target.value })}
          >
            <option value="Healing">Healing</option>
            <option value="Potion">Potion</option>
            <option value="Support">Support</option>
            <option value="Attack">Attack</option>
            <option value="Equip">Equip</option>
            <option value="Others">Others</option>
          </ListSelect>
          <ListSelect
            className="input input-hotkey"
            id="key"
            value={healing.key}
            onChange={(event) => handleUpdateRule({ key: event.target.value })}
            placeholder="F1"
          >
            {keyboardKeys.map((key) => (
              <option key={key.value} value={key.value}>
                {key.label}
              </option>
            ))}
          </ListSelect>
          <ListSelect
            className="input input-percent-select"
            id="hpTriggerCondition"
            value={healing.hpTriggerCondition}
            onChange={(event) => handleUpdateRule({ hpTriggerCondition: event.target.value })}
          >
            <option value="<=">{'≤'}</option>
            <option value="<">{'<'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
            <option value="!=">{'≠'}</option>
          </ListSelect>
          <ListInput
            className="input-percent"
            type="number"
            min="0"
            max="100"
            step="1"
            id="hpTriggerPercentage"
            value={localInputs.hpTriggerPercentage}
            onChange={handleNumericInputChange('hpTriggerPercentage', 0, 100)}
            onBlur={handleNumericInputBlur('hpTriggerPercentage', 0, 100)}
            placeholder="0"
          />
          <select
            className="input input-percent-select"
            id="manaTriggerCondition"
            value={healing.manaTriggerCondition}
            onChange={(event) => handleUpdateRule({ manaTriggerCondition: event.target.value })}
          >
            <option value="<=">{'≤'}</option>
            <option value="<">{'<'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
            <option value="!=">{'≠'}</option>
          </select>
          <ListInput
            type="number"
            min="0"
            max="100"
            step="1"
            className="input input-percent"
            id="manaTriggerPercentage"
            value={localInputs.manaTriggerPercentage}
            onChange={handleNumericInputChange('manaTriggerPercentage', 0, 100)}
            onBlur={handleNumericInputBlur('manaTriggerPercentage', 0, 100)}
            placeholder="0"
          />
          <ListSelect
            className="input input-monster-num-condition"
            id="monsterNumCondition"
            value={healing.monsterNumCondition}
            onChange={(event) => handleUpdateRule({ monsterNumCondition: event.target.value })}
          >
            <option value="<">{'<'}</option>
            <option value="<=">{'≤'}</option>
            <option value="=">{'='}</option>
            <option value=">">{'>'}</option>
            <option value=">=">{'≥'}</option>
          </ListSelect>
          <ListInput
            type="number"
            className="input input-monster-num"
            id="monsterNum"
            value={localInputs.monsterNum}
            onChange={handleNumericInputChange('monsterNum', 0, 10)}
            onBlur={handleNumericInputBlur('monsterNum', 0, 10)}
            min="0"
            max="10"
            placeholder="0"
          />
          <ListInput
            type="number"
            className="input input-priority"
            id="priority"
            value={localInputs.priority}
            onChange={handleNumericInputChange('priority', -99, 99)}
            onBlur={handleNumericInputBlur('priority', -99, 99)}
            min="-99"
            max="99"
            placeholder="Priority"
          />
          <ListInput
            type="number"
            className="input-delay"
            id="delay"
            value={localInputs.delay}
            onChange={handleNumericInputChange('delay', 25, 840000)}
            onBlur={handleNumericInputBlur('delay', 25, 840000)}
            placeholder="5"
            min="25"
            step="25"
          />
          <button
            className="remove-rule-button rule-button"
            type="button"
            onMouseDown={handleRemoveRule}
            aria-label="remove-rule"
          >
            ×
          </button>
          <button
            type="button"
            className="rule-button button-expand"
            style={{ pointerEvents: 'none' }}
          >
            {isOpen ? '▴' : '▾'}
          </button>
        </summary>
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
    conditions: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
  className: PropTypes.string,
};

export default HealingRule;
