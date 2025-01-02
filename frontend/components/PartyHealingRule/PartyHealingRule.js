import React, { useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import keyboardKeys from '../../constants/keyboardKeys.js';
import CharacterStatusConditions from '../CharacterStatusConditions/CharacterStatusConditions.jsx';

import { removeRule, updateCondition, updateRule } from '../../redux/slices/healingSlice.js';
import StyledDiv from './PartyHealingRule.styled.js';
import CustomCheckbox from '../CustomCheckbox/CustomCheckbox.js';
import ListInput from '../ListInput/ListInput.js';
import ListSelect from '../ListSelect/ListSelect.js';
import ConfirmDialog from '../ConfirmDialog/ConfirmDialog.jsx';

const PartyHealingRule = ({ rule, className }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const currentRule = useSelector((state) => state.healing.presets[activePresetIndex].find((r) => r.id === rule.id));

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
      const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
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
          <CharacterStatusConditions ruleId={rule.id} onStatusConditionChange={handleStatusConditionChange} />
          <summary
            onKeyDown={(e) => {
              if (e.code === 'Space' || e.code === 'Enter') {
                e.preventDefault();
              }
            }}
          >
            <CustomCheckbox checked={currentRule.enabled} onChange={handleFieldChange('enabled')} width={22} height={22} />

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

            <div>
              <CustomCheckbox
                checked={currentRule.useRune}
                onChange={handleFieldChange('useRune')}
                width={35}
                height={22}
                label="Use Rune"
              />
            </div>
            <div>
              <CustomCheckbox
                checked={currentRule.requireAttackCooldown}
                onChange={handleFieldChange('requireAttackCooldown')}
                width={100}
                height={22}
                label="Require Attack Cooldown"
              />
            </div>

            <ListInput
              className="input-party-position"
              type="number"
              defaultValue={1}
              min="0"
              max="20"
              step="1"
              id="partyPosition"
              value={currentRule.partyPosition}
              onChange={handleFieldChange('partyPosition')}
              placeholder="80"
            />

            <ListSelect className="input input-percent-select" id="hpTriggerCondition" disabled="true" value="≤">
              <option value="<=">{'≤'}</option>
            </ListSelect>
            <ListInput
              className="input-percent"
              type="number"
              min="0"
              max="100"
              step="1"
              id="friendHpTriggerPercentage"
              value={currentRule.friendHpTriggerPercentage}
              onChange={handleFieldChange('friendHpTriggerPercentage')}
              placeholder="80"
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
              min="0"
              step="25"
            />

            <button className="remove-rule-button rule-button" type="button" onMouseDown={handleRemoveRule} aria-label="remove-rule">
              ×
            </button>
            <button type="button" className="rule-button button-expand" style={{ pointerEvents: 'none' }}>
              ▾
            </button>
          </summary>
        </details>
      </StyledDiv>
    </>
  );
};

PartyHealingRule.propTypes = {
  rule: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    enabled: PropTypes.bool,
    key: PropTypes.string,
    conditions: PropTypes.arrayOf(PropTypes.object),
    requireManaShield: PropTypes.bool,
    useRune: PropTypes.bool,
    requireAttackCooldown: PropTypes.bool,
    friendHpTriggerPercentage: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  className: PropTypes.string,
  variant: PropTypes.string,
};

export default PartyHealingRule;
