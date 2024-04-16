import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { updateRule, removeRule, updateCondition } from '../../redux/slices/healingSlice.js';
import StyledDiv from './HealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';

const { api } = window;

const HealingRule = ({ rule }) => {
  const dispatch = useDispatch();
  const healing = useSelector((state) => state.healing.find((r) => r.id === rule.id)) || {};
  const [localHealing, setLocalHealing] = useState(healing);
  const [isOpen, setIsOpen] = useState(false);

  const [statusConditions, setStatusConditions] = useState({});

  useEffect(() => {
    dispatch(updateRule(localHealing));
  }, [localHealing]);

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
        <CharacterStatusConditions
          ruleId={rule.id} // Pass the ruleId to the CharacterStatusConditions component
          onStatusConditionChange={handleStatusConditionChange} // Define the callback if needed
        />
        <summary>
          <CustomCheckbox
            checked={healing.enabled}
            onChange={() =>
              setLocalHealing((prevLocalHealing) => ({
                ...prevLocalHealing,
                enabled: !prevLocalHealing.enabled,
                conditions: prevLocalHealing.conditions,
              }))
            }
            disabled={!requiredFieldsFilled}
            size={22}
          />
          <ListInput
            className="input"
            id="name"
            value={localHealing.name}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                name: event.target.value,
              })
            }
            placeholder="Rule Name"
            disabled={healing.enabled}
          />

          <ListSelect
            className="input input-category select-with-arrow"
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
            <option value="Potion">Potion</option>
            <option value="Support">Support</option>
            <option value="Attack">Attack</option>
            <option value="Equip">Equip</option>
            <option value="Others">Others</option>
          </ListSelect>
          <ListSelect
            className="input input-hotkey"
            id="key"
            value={localHealing.key}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                key: event.target.value,
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
          </ListSelect>
          <ListSelect
            className="input input-percent-select"
            id="hpTriggerCondition"
            value={localHealing.hpTriggerCondition}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                hpTriggerCondition: event.target.value,
              })
            }
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
            value={localHealing.hpTriggerPercentage}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                hpTriggerPercentage: event.target.value,
              })
            }
            placeholder="0"
            disabled={healing.enabled}
          />
          <select
            className="input input-percent-select"
            id="manaTriggerCondition"
            value={localHealing.manaTriggerCondition}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                manaTriggerCondition: event.target.value,
              })
            }
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
            value={localHealing.manaTriggerPercentage}
            onChange={(event) => {
              if (event.target.value !== undefined) {
                setLocalHealing({
                  ...localHealing,
                  manaTriggerPercentage: event.target.value,
                });
              }
            }}
            placeholder="0"
            disabled={healing.enabled}
          />
          <ListInput
            type="number"
            className="input input-priority"
            id="priority"
            value={localHealing.priority}
            onChange={(event) =>
              setLocalHealing({
                ...localHealing,
                priority: event.target.value,
              })
            }
            min="0"
            max="99"
            placeholder="Priority"
            disabled={healing.enabled}
          />
          <ListInput
            type="number"
            className="input-delay"
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
