import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { updateRule, removeRule, updateCondition } from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';

const HealingRule = ({ rule, className }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id)) || {};
  const [isOpen, setIsOpen] = useState(false);

  const [statusConditions, setStatusConditions] = useState({});

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
    dispatch(updateRule({ ...healing, ...updatedFields }));
  };

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
            value={healing.hpTriggerPercentage}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              const validValue = Math.max(0, Math.min(100, value));
              handleUpdateRule({ hpTriggerPercentage: validValue });
            }}
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
            value={healing.manaTriggerPercentage}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              const validValue = Math.max(0, Math.min(100, value));
              handleUpdateRule({ manaTriggerPercentage: validValue });
            }}
            placeholder="0"
          />{' '}
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
            value={healing.monsterNum}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              const validValue = Math.max(0, Math.min(10, value));
              handleUpdateRule({ monsterNum: validValue });
            }}
            min="0"
            max="10"
            placeholder="0"
          />
          <ListInput
            type="number"
            className="input input-priority"
            id="priority"
            value={healing.priority}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              const validValue = Math.max(-99, Math.min(99, value));
              handleUpdateRule({ priority: validValue });
            }}
            min="-99"
            max="99"
            placeholder="Priority"
          />
          <ListInput
            type="number"
            className="input-delay"
            id="delay"
            value={healing.delay}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              const validValue = Math.max(25, Math.min(360000, value));
              handleUpdateRule({ delay: validValue });
            }}
            placeholder="25"
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

    // eslint-disable-next-line react/forbid-prop-types
    conditions: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
};

export default HealingRule;
