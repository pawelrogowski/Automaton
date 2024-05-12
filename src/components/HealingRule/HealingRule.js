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
            disabled={!requiredFieldsFilled}
            size={22}
          />
          <ListInput
            className="input"
            id="name"
            value={healing.name}
            onChange={(event) => handleUpdateRule({ name: event.target.value })}
            placeholder="Rule Name"
            disabled={healing.enabled}
          />
          <ListSelect
            className="input input-category select-with-arrow"
            id="category"
            value={healing.category}
            onChange={(event) => handleUpdateRule({ category: event.target.value })}
            disabled={healing.enabled}
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
            disabled={healing.enabled}
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
            disabled={healing.enabled}
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
            onChange={(event) => handleUpdateRule({ hpTriggerPercentage: event.target.value })}
            placeholder="0"
            disabled={healing.enabled}
          />
          <select
            className="input input-percent-select"
            id="manaTriggerCondition"
            value={healing.manaTriggerCondition}
            onChange={(event) => handleUpdateRule({ manaTriggerCondition: event.target.value })}
            disabled={healing.enabled}
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
            onChange={(event) => handleUpdateRule({ manaTriggerPercentage: event.target.value })}
            placeholder="0"
            disabled={healing.enabled}
          />{' '}
          <ListSelect
            className="input input-monster-num-condition"
            id="monsterNumCondition"
            value={healing.monsterNumCondition}
            onChange={(event) => handleUpdateRule({ monsterNumCondition: event.target.value })}
            disabled={healing.enabled}
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
            onChange={(event) => handleUpdateRule({ monsterNum: event.target.value })}
            min="0"
            max="10"
            placeholder="0"
            disabled={healing.enabled}
          />
          <ListInput
            type="number"
            className="input input-priority"
            id="priority"
            value={healing.priority}
            onChange={(event) => handleUpdateRule({ priority: event.target.value })}
            min="0"
            max="99"
            placeholder="Priority"
            disabled={healing.enabled}
          />
          <ListInput
            type="number"
            className="input-delay"
            id="delay"
            value={healing.delay}
            onChange={(event) => handleUpdateRule({ delay: event.target.value })}
            placeholder="25"
            min="25"
            step="25"
            disabled={healing.enabled}
          />
          <button
            className="remove-rule-button rule-button"
            type="button"
            onClick={handleRemoveRule}
            disabled={healing.enabled}
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
