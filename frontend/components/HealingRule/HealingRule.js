import React, { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import {
  removeRule,
  updateCondition,
  updateRule,
} from '../../redux/slices/ruleSlice.js';
import StyledDiv from './HealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';

const HealingRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const dispatch = useDispatch();
  // Use the rule prop directly instead of re-selecting from Redux (optimization)
  const current_rule = rule;

  const handleStatusConditionChange = (status, value) => {
    dispatch(updateCondition({ id: currentRule.id, condition: status, value }));
  };

  const handleRemoveRule = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    dispatch(removeRule(currentRule.id));
    setShowConfirm(false);
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  const conditionOptions = [
    { value: '<=', label: '≤' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '!=', label: '≠' },
  ];

  const handleFieldChange = useCallback(
    (field) => (event) => {
      const value =
        event.target.type === 'checkbox'
          ? event.target.checked
          : event.target.value;
      dispatch(updateRule({ id: currentRule.id, field, value }));
    },
    [dispatch, currentRule.id],
  );

  return (
    <>
      {showConfirm && (
        <ConfirmDialog
          title="Remove Rule Confirmation"
          text="Are you sure you want to delete this rule?"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      <StyledDiv className={className} $running={currentRule.enabled}>
        <details>
          <CharacterStatusConditions
            ruleId={rule.id}
            onStatusConditionChange={handleStatusConditionChange}
          />
          <summary
            onKeyDown={(e) => {
              if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
              }
            }}
          >
            <CustomCheckbox
              checked={currentRule.enabled}
              onChange={handleFieldChange('enabled')}
              width={22}
              height={22}
            />

            <ListInput
              className="input"
              id="name"
              value={currentRule.name}
              onChange={handleFieldChange('name')}
              placeholder="Rule Name"
            />
            <ListSelect
              className="input input-category select-with-arrow"
              id="category"
              value={currentRule.category}
              onChange={handleFieldChange('category')}
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
              value={currentRule.key}
              onChange={handleFieldChange('key')}
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
              value={currentRule.hpTriggerCondition}
              onChange={handleFieldChange('hpTriggerCondition')}
            >
              {conditionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </ListSelect>
            <ListInput
              className="input-percent"
              type="number"
              min="0"
              max="100"
              step="1"
              id="hpTriggerPercentage"
              value={currentRule.hpTriggerPercentage}
              onChange={handleFieldChange('hpTriggerPercentage')}
              placeholder="0"
            />
            <ListSelect
              className="input input-percent-select"
              id="manaTriggerCondition"
              value={currentRule.manaTriggerCondition}
              onChange={handleFieldChange('manaTriggerCondition')}
            >
              {conditionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </ListSelect>
            <ListInput
              type="number"
              min="0"
              max="100"
              step="1"
              className="input input-percent"
              id="manaTriggerPercentage"
              value={currentRule.manaTriggerPercentage}
              onChange={handleFieldChange('manaTriggerPercentage')}
              placeholder="0"
            />
            <ListSelect
              className="input input-monster-num-condition"
              id="monsterNumCondition"
              value={currentRule.monsterNumCondition}
              onChange={handleFieldChange('monsterNumCondition')}
            >
              {conditionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </ListSelect>
            <ListInput
              type="number"
              className="input input-monster-num"
              id="monsterNum"
              value={currentRule.monsterNum}
              onChange={handleFieldChange('monsterNum')}
              min="0"
              max="10"
              placeholder="0"
            />
            <ListInput
              type="number"
              className="input input-priority"
              id="priority"
              value={currentRule.priority}
              onChange={handleFieldChange('priority')}
              min="-999"
              max="999"
              placeholder="Priority"
            />
            <ListInput
              type="number"
              className="input-delay"
              id="delay"
              value={currentRule.delay}
              onChange={handleFieldChange('delay')}
              placeholder="5"
              min="25"
              step="25"
            />
            <CustomCheckbox
              checked={currentRule.isWalking}
              onChange={handleFieldChange('isWalking')}
              width={22}
              height={22}
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
              ▾
            </button>
          </summary>
        </details>
      </StyledDiv>
    </>
  );
};

HealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    conditions: PropTypes.arrayOf(PropTypes.object),
    requireManaShield: PropTypes.bool,
    useRune: PropTypes.bool,
    requireAttackCooldown: PropTypes.bool,
  }).isRequired,
  className: PropTypes.string,
  variant: PropTypes.string,
};

export default HealingRule;
